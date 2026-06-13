import CryptoKit
import Darwin
import ExpoModulesCore
import Foundation
import llama
#if canImport(CLiteRTLM)
import CLiteRTLM
#endif

public class CaremindGemmaModule: Module {
  private let store = IosModelStore()
  private let engine = IosGemmaEngine()
  private var downloadTasks: [String: URLSessionDownloadTask] = [:]
  private var cancelledDownloads: Set<String> = []

  public func definition() -> ModuleDefinition {
    Name("CaremindGemma")

    Events("CaremindGemma_DownloadProgress")

    AsyncFunction("isModelReady") { (filename: String) -> Bool in
      try self.store.validateFilename(filename)
      return self.store.isModelReady(filename)
    }

    AsyncFunction("getModelPath") { (filename: String) -> String in
      try self.store.validateFilename(filename)
      return self.store.modelURL(filename).path
    }

    AsyncFunction("downloadModel") { (filename: String, urlString: String, checksum: String?, expectedBytesNumber: Double?) async throws -> [String: Any] in
      try self.store.validateFilename(filename)

      if self.engine.isStubModeEnabled {
        let fileURL = try self.store.writeStubModel(filename)
        self.sendProgress(filename: filename, bytesDownloaded: 1, totalBytes: 1)
        return ["path": fileURL.path, "filename": filename, "bytes": 1]
      }

      guard let sourceURL = URL(string: urlString) else {
        throw CaremindGemmaError.badUrl
      }

      let expectedBytes = expectedBytesNumber.flatMap { value -> Int64? in
        let rounded = Int64(value)
        return rounded > 0 ? rounded : nil
      }
      self.cancelledDownloads.remove(filename)
      let targetURL = try await self.downloadModelFile(
        filename: filename,
        sourceURL: sourceURL,
        checksum: checksum,
        expectedBytes: expectedBytes
      )
      return ["path": targetURL.path, "filename": filename, "bytes": try self.store.fileSize(targetURL)]
    }

    AsyncFunction("cancelDownload") { (filename: String) in
      try self.store.validateFilename(filename)
      self.cancelledDownloads.insert(filename)
      self.downloadTasks[filename]?.cancel()
      self.downloadTasks[filename] = nil
    }

    AsyncFunction("deleteModel") { (filename: String) in
      try self.store.validateFilename(filename)
      if self.engine.loadedModelId == filename {
        self.engine.release()
      }
      try self.store.deleteModel(filename)
    }

    AsyncFunction("initEngine") { (filename: String, options: [String: Any]?) async throws in
      try self.store.validateFilename(filename)
      guard self.store.isModelReady(filename) else {
        throw CaremindGemmaError.modelNotFound
      }
      try await self.engine.load(modelId: filename, modelPath: self.store.modelURL(filename).path, options: options)
    }

    AsyncFunction("releaseEngine") {
      self.engine.release()
    }

    AsyncFunction("logMemorySnapshot") { (label: String?) in
      self.engine.logMemorySnapshot(label: label ?? "manual")
    }

    AsyncFunction("getRuntimeInfo") { () -> [String: Any] in
      self.engine.runtimeInfo()
    }

    AsyncFunction("generate") { (prompt: String, options: [String: Any]) async throws -> [String: Any] in
      let filename = options["filename"] as? String
      if let filename {
        try self.store.validateFilename(filename)
        guard self.store.isModelReady(filename) else {
          throw CaremindGemmaError.modelNotFound
        }
        try await self.engine.load(modelId: filename, modelPath: self.store.modelURL(filename).path, options: options)
      }

      let started = Date()
      let result = try await self.engine.generate(prompt: prompt, options: options)
      let elapsedMs = Int(Date().timeIntervalSince(started) * 1000)
      let runtime = self.engine.runtimeInfo()
      let isStub = self.engine.isStubModeEnabled
      return [
        "text": result.text,
        "tokenCount": result.tokenCount,
        "elapsedMs": elapsedMs,
        "source": isStub ? "stub_debug" : "native_litertlm_success",
        "modelId": runtime["loadedModelId"] as? String ?? filename ?? "unknown",
        "backend": runtime["accelerator"] as? String ?? runtime["runtime"] as? String ?? "unknown",
        "engineInitialized": !isStub
      ]
    }

    AsyncFunction("generateWithAudio") { (_: String, _: String, _: [String: Any]) throws -> [String: Any] in
      throw CaremindGemmaError.localAudioNotSupported
    }

    AsyncFunction("cancelGeneration") { (_: String) in
      self.engine.cancel()
    }

    AsyncFunction("setStubMode") { (enabled: Bool) in
      #if DEBUG
      self.engine.stubMode = enabled
      if enabled {
        self.engine.release()
      }
      #else
      self.engine.stubMode = false
      if enabled {
        NSLog("[CaremindGemma] stub mode is disabled in non-debug builds")
      }
      #endif
    }
  }

  private func sendProgress(filename: String, bytesDownloaded: Int64, totalBytes: Int64) {
    let safeTotal = max(totalBytes, bytesDownloaded)
    let ratio = safeTotal > 0 ? Double(bytesDownloaded) / Double(safeTotal) : 0
    sendEvent("CaremindGemma_DownloadProgress", [
      "filename": filename,
      "bytesDownloaded": bytesDownloaded,
      "totalBytes": safeTotal,
      "ratio": ratio
    ])
  }

  private func downloadModelFile(
    filename: String,
    sourceURL: URL,
    checksum: String?,
    expectedBytes: Int64?
  ) async throws -> URL {
    let targetURL = store.modelURL(filename)
    let partialURL = store.partialModelURL(filename)
    let maxAttempts = 4
    var lastError: Error?

    try store.prepareModelsDirectory()

    for attempt in 1...maxAttempts {
      if cancelledDownloads.contains(filename) {
        throw CaremindGemmaError.downloadCancelled
      }

      let existingBytes = store.fileSizeIfExists(partialURL)
      var request = URLRequest(url: sourceURL)
      request.httpMethod = "GET"
      request.timeoutInterval = 120
      if existingBytes > 0 {
        request.setValue("bytes=\(existingBytes)-", forHTTPHeaderField: "Range")
      }

      do {
        let (tempURL, response) = try await URLSession.shared.download(for: request)
        guard let http = response as? HTTPURLResponse else {
          throw CaremindGemmaError.badServerResponse
        }

        let status = http.statusCode
        let contentLength = IosModelStore.headerInt64(http.value(forHTTPHeaderField: "Content-Length")) ?? response.expectedContentLength
        let retryCount = attempt - 1
        print("[CaremindGemma] download attempt model=\(filename) host=\(http.url?.host ?? sourceURL.host ?? "unknown") status=\(status) contentLength=\(max(contentLength, 0)) retry=\(retryCount)")

        guard (200...299).contains(status) else {
          try? FileManager.default.removeItem(at: tempURL)
          let error = CaremindGemmaError.httpStatus(status)
          if status >= 500 && attempt < maxAttempts {
            lastError = error
            try await Task.sleep(nanoseconds: UInt64(min(attempt * 1_500, 6_000)) * 1_000_000)
            continue
          }
          throw error
        }

        let resumed = existingBytes > 0 && status == 206
        if existingBytes > 0 && status == 200 {
          try? FileManager.default.removeItem(at: partialURL)
        }
        let offset = resumed ? existingBytes : 0
        let serverTotal = IosModelStore.contentRangeTotal(http.value(forHTTPHeaderField: "Content-Range"))
        let downloadedChunkBytes = try store.fileSize(tempURL)
        let totalBytes = expectedBytes ?? serverTotal ?? (offset + downloadedChunkBytes)
        try store.assertEnoughDiskSpace(bytesRemaining: max(totalBytes - offset, 0))

        if resumed {
          try store.appendFile(tempURL, to: partialURL)
          try? FileManager.default.removeItem(at: tempURL)
        } else {
          try? FileManager.default.removeItem(at: partialURL)
          try FileManager.default.moveItem(at: tempURL, to: partialURL)
        }

        let actualBytes = try store.fileSize(partialURL)
        self.sendProgress(filename: filename, bytesDownloaded: actualBytes, totalBytes: max(totalBytes, actualBytes))
        if totalBytes > 0 && actualBytes != totalBytes {
          throw CaremindGemmaError.partialDownload("模型下载大小不完整：\(actualBytes) / \(totalBytes)")
        }

        if let checksum, !checksum.isEmpty {
          let actualChecksum = try store.sha256(partialURL)
          guard actualChecksum.lowercased() == checksum.lowercased() else {
            try? FileManager.default.removeItem(at: partialURL)
            throw CaremindGemmaError.checksumFailed
          }
        }

        try? FileManager.default.removeItem(at: targetURL)
        try FileManager.default.moveItem(at: partialURL, to: targetURL)
        try store.excludeFromBackup(targetURL)
        cancelledDownloads.remove(filename)
        return targetURL
      } catch let error as URLError {
        let mapped: CaremindGemmaError = error.code == .timedOut ? .networkTimeout : .downloadFailed(error.localizedDescription)
        if attempt == maxAttempts {
          throw mapped
        }
        lastError = mapped
      } catch {
        if attempt == maxAttempts {
          throw error
        }
        lastError = error
      }
    }

    throw lastError ?? CaremindGemmaError.downloadFailed("unknown")
  }
}

enum CaremindGemmaError: Error, LocalizedError {
  case badFilename
  case badUrl
  case modelNotFound
  case checksumFailed
  case httpStatus(Int)
  case badServerResponse
  case networkTimeout
  case insufficientDiskSpace(Int64, Int64)
  case partialDownload(String)
  case downloadFailed(String)
  case downloadCancelled
  case localAudioNotSupported
  case modelLoadFailed(String)
  case contextInitFailed
  case tokenizationFailed
  case promptTooLong(Int, Int)
  case inferenceFailed(String)

  var errorDescription: String? {
    switch self {
    case .badFilename:
      return "非法的模型文件名。"
    case .badUrl:
      return "模型下载地址无效。"
    case .modelNotFound:
      return "当前选中的 iPhone 本地模型未就绪。"
    case .checksumFailed:
      return "模型文件校验失败，请重新下载。"
    case .httpStatus(let status):
      if status == 401 || status == 403 {
        return "模型下载失败：HTTP \(status)，模型源鉴权或许可未通过。"
      }
      if status == 404 {
        return "模型下载失败：HTTP 404，模型文件不存在。"
      }
      if status == 408 || status == 504 {
        return "模型下载超时：HTTP \(status)，请保持网络连接后重试。"
      }
      if status >= 500 {
        return "模型下载失败：服务器返回 HTTP \(status)。"
      }
      return "模型下载失败：HTTP \(status)。"
    case .badServerResponse:
      return "模型下载失败：服务器响应格式不正确。"
    case .networkTimeout:
      return "模型下载超时：网络不稳定或文件过大，请保持网络连接后重试。"
    case .insufficientDiskSpace(let required, let available):
      return "手机剩余空间不足：还需要约 \(required / 1024 / 1024)MB，可用约 \(available / 1024 / 1024)MB。"
    case .partialDownload(let reason):
      return "\(reason)，请重新点击下载继续。"
    case .downloadFailed(let reason):
      return "模型下载失败：\(reason)"
    case .downloadCancelled:
      return "下载已取消。"
    case .localAudioNotSupported:
      return "iPhone 隐私模式暂不支持本地语音转文字，请先手动输入，或明确选择云端转写。"
    case .modelLoadFailed(let reason):
      return "iPhone 本地模型加载失败：\(reason)"
    case .contextInitFailed:
      return "llama.cpp 上下文初始化失败。"
    case .tokenizationFailed:
      return "本地模型无法解析当前提示词。"
    case .promptTooLong(let promptTokens, let contextTokens):
      return "当前照护记录太长，本地模型上下文不足：\(promptTokens)/\(contextTokens) tokens。"
    case .inferenceFailed(let reason):
      return "iPhone 本地推理失败：\(reason)"
    }
  }
}

final class IosModelStore {
  private let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")

  func validateFilename(_ filename: String) throws {
    guard !filename.isEmpty,
          filename.rangeOfCharacter(from: allowed.inverted) == nil,
          !filename.contains(".."),
          !filename.contains("/") else {
      throw CaremindGemmaError.badFilename
    }
  }

  func modelsDirectory() -> URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("CareMind", isDirectory: true)
      .appendingPathComponent("Models", isDirectory: true)
  }

  func prepareModelsDirectory() throws {
    let directory = modelsDirectory()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try excludeFromBackup(directory)
  }

  func modelURL(_ filename: String) -> URL {
    modelsDirectory().appendingPathComponent(filename, isDirectory: false)
  }

  func partialModelURL(_ filename: String) -> URL {
    modelsDirectory().appendingPathComponent("\(filename).partial", isDirectory: false)
  }

  func isModelReady(_ filename: String) -> Bool {
    FileManager.default.fileExists(atPath: modelURL(filename).path)
  }

  func writeStubModel(_ filename: String) throws -> URL {
    try prepareModelsDirectory()
    let url = modelURL(filename)
    try Data("caremind-ios-stub-model".utf8).write(to: url, options: .atomic)
    try excludeFromBackup(url)
    return url
  }

  func deleteModel(_ filename: String) throws {
    try? FileManager.default.removeItem(at: partialModelURL(filename))
    let url = modelURL(filename)
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }

  func excludeFromBackup(_ url: URL) throws {
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutableURL = url
    try mutableURL.setResourceValues(values)
  }

  func fileSize(_ url: URL) throws -> Int64 {
    let values = try url.resourceValues(forKeys: [.fileSizeKey])
    return Int64(values.fileSize ?? 0)
  }

  func fileSizeIfExists(_ url: URL) -> Int64 {
    guard FileManager.default.fileExists(atPath: url.path) else { return 0 }
    return (try? fileSize(url)) ?? 0
  }

  func appendFile(_ sourceURL: URL, to targetURL: URL) throws {
    if !FileManager.default.fileExists(atPath: targetURL.path) {
      FileManager.default.createFile(atPath: targetURL.path, contents: nil)
    }
    let input = try FileHandle(forReadingFrom: sourceURL)
    let output = try FileHandle(forWritingTo: targetURL)
    defer {
      try? input.close()
      try? output.close()
    }
    try output.seekToEnd()
    while autoreleasepool(invoking: {
      let data = input.readData(ofLength: 1024 * 1024)
      if data.isEmpty { return false }
      output.write(data)
      return true
    }) {}
  }

  func assertEnoughDiskSpace(bytesRemaining: Int64) throws {
    let directory = modelsDirectory()
    let values = try directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
    let available = Int64(values.volumeAvailableCapacityForImportantUsage ?? 0)
    let required = bytesRemaining + 512 * 1024 * 1024
    guard available >= required else {
      throw CaremindGemmaError.insufficientDiskSpace(required, available)
    }
  }

  func sha256(_ url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hasher = SHA256()
    while autoreleasepool(invoking: {
      let data = handle.readData(ofLength: 1024 * 1024)
      if data.isEmpty { return false }
      hasher.update(data: data)
      return true
    }) {}
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  static func headerInt64(_ value: String?) -> Int64? {
    guard let value else { return nil }
    return Int64(value.trimmingCharacters(in: .whitespacesAndNewlines))
  }

  static func contentRangeTotal(_ value: String?) -> Int64? {
    guard let value, let slash = value.lastIndex(of: "/") else { return nil }
    let suffix = value[value.index(after: slash)...]
    return Int64(suffix)
  }
}

struct IosGemmaGeneration {
  let text: String
  let tokenCount: Int
}

struct IosLlamaLoadOptions: Equatable {
  let backend: String
  let contextTokens: UInt32

  init(_ options: [String: Any]?) {
    backend = (options?["backend"] as? String ?? "AUTO").uppercased()
    let requested = IosLlamaLoadOptions.intValue(options?["contextTokens"])
      ?? IosLlamaLoadOptions.intValue(options?["maxTokens"])
      ?? 2048
    contextTokens = UInt32(min(4096, max(1024, requested)))
  }

  var gpuLayers: Int32 {
    return 0
  }

  var accelerator: String {
    "cpu"
  }

  private static func intValue(_ value: Any?) -> Int? {
    if let value = value as? Int { return value }
    if let value = value as? Double { return Int(value) }
    if let value = value as? NSNumber { return value.intValue }
    return nil
  }
}

struct IosLlamaGenerateOptions {
  let maxNewTokens: Int
  let temperature: Float
  let topK: Int32

  init(_ options: [String: Any]) {
    maxNewTokens = min(1024, max(1, IosLlamaGenerateOptions.intValue(options["maxTokens"]) ?? 768))
    temperature = Float(min(1.5, max(0.0, IosLlamaGenerateOptions.doubleValue(options["temperature"]) ?? 0.4)))
    topK = Int32(min(128, max(1, IosLlamaGenerateOptions.intValue(options["topK"]) ?? 40)))
  }

  private static func intValue(_ value: Any?) -> Int? {
    if let value = value as? Int { return value }
    if let value = value as? Double { return Int(value) }
    if let value = value as? NSNumber { return value.intValue }
    return nil
  }

  private static func doubleValue(_ value: Any?) -> Double? {
    if let value = value as? Double { return value }
    if let value = value as? Int { return Double(value) }
    if let value = value as? NSNumber { return value.doubleValue }
    return nil
  }
}

struct IosLiteRTLoadOptions: Equatable {
  let backend: String
  let maxNumTokens: Int

  init(_ options: [String: Any]?) {
    backend = (options?["backend"] as? String ?? "AUTO").uppercased()
    let requested = IosLiteRTLoadOptions.intValue(options?["contextTokens"])
      ?? IosLiteRTLoadOptions.intValue(options?["maxTokens"])
      ?? 1024
    maxNumTokens = min(2048, max(512, requested))
  }

  var accelerator: String {
    backend == "CPU" ? "cpu" : "metal"
  }

  private static func intValue(_ value: Any?) -> Int? {
    if let value = value as? Int { return value }
    if let value = value as? Double { return Int(value) }
    if let value = value as? NSNumber { return value.intValue }
    return nil
  }
}

struct IosLiteRTGenerateOptions {
  let temperature: Float
  let topK: Int
  let topP: Float

  init(_ options: [String: Any]) {
    temperature = Float(min(1.5, max(0.0, IosLiteRTGenerateOptions.doubleValue(options["temperature"]) ?? 0.4)))
    topK = min(128, max(1, IosLiteRTGenerateOptions.intValue(options["topK"]) ?? 40))
    topP = Float(min(1.0, max(0.0, IosLiteRTGenerateOptions.doubleValue(options["topP"]) ?? 0.95)))
  }

  private static func intValue(_ value: Any?) -> Int? {
    if let value = value as? Int { return value }
    if let value = value as? Double { return Int(value) }
    if let value = value as? NSNumber { return value.intValue }
    return nil
  }

  private static func doubleValue(_ value: Any?) -> Double? {
    if let value = value as? Double { return value }
    if let value = value as? Int { return Double(value) }
    if let value = value as? NSNumber { return value.doubleValue }
    return nil
  }
}

final class IosGemmaEngine {
  private let stateLock = NSRecursiveLock()
  private let cancelLock = NSLock()
  private let stubResponder = IosGemmaStubResponder()
  private var llamaContext: IosLlamaContext?
  private var loadedOptions: IosLlamaLoadOptions?
  private var litertContext: IosLiteRTLMContext?
  private var loadedLiteRTOptions: IosLiteRTLoadOptions?
  private var cancelled = false

  var stubMode = false
  var isStubModeEnabled: Bool {
    #if DEBUG
    return stubMode
    #else
    return false
    #endif
  }
  private(set) var loadedModelId: String?

  func load(modelId: String, modelPath: String, options: [String: Any]?) async throws {
    setCancelled(false)
    if isStubModeEnabled {
      loadedModelId = modelId
      loadedOptions = nil
      return
    }

    if IosGemmaEngine.isLiteRTModel(modelPath) {
      let nextOptions = IosLiteRTLoadOptions(options)
      if loadedModelId == modelId, loadedLiteRTOptions == nextOptions, litertContext != nil {
        return
      }

      releaseLocked()
      litertContext = try await IosLiteRTLMContext(modelPath: modelPath, options: nextOptions)
      loadedModelId = modelId
      loadedLiteRTOptions = nextOptions
    } else {
      let nextOptions = IosLlamaLoadOptions(options)
      if loadedModelId == modelId, loadedOptions == nextOptions, llamaContext != nil {
        return
      }

      releaseLocked()
      llamaContext = try IosLlamaContext(modelPath: modelPath, options: nextOptions)
      loadedModelId = modelId
      loadedOptions = nextOptions
    }
  }

  func release() {
    stateLock.lock()
    defer { stateLock.unlock() }
    releaseLocked()
    setCancelled(false)
  }

  func cancel() {
    litertContext?.cancel()
    setCancelled(true)
  }

  func generate(prompt: String, options: [String: Any]) async throws -> IosGemmaGeneration {
    if isCancelled() {
      setCancelled(false)
      return IosGemmaGeneration(text: IosGemmaEngine.cancelledXml, tokenCount: 0)
    }

    if isStubModeEnabled {
      let text = stubResponder.generate(prompt: prompt)
      return IosGemmaGeneration(text: text, tokenCount: max(1, text.count / 4))
    }

    if let litertContext {
      let generation = try await litertContext.generate(
        prompt: prompt,
        options: IosLiteRTGenerateOptions(options)
      )
      if isCancelled() {
        setCancelled(false)
        return IosGemmaGeneration(text: IosGemmaEngine.cancelledXml, tokenCount: generation.tokenCount)
      }
      return generation
    }

    if let llamaContext {
      let generateOptions = IosLlamaGenerateOptions(options)
      let generation = try llamaContext.generate(
        prompt: prompt,
        options: generateOptions,
        isCancelled: { [weak self] in self?.isCancelled() ?? false }
      )
      if isCancelled() {
        setCancelled(false)
      }
      return generation
    }

    throw CaremindGemmaError.modelNotFound
  }

  func runtimeInfo() -> [String: Any] {
    stateLock.lock()
    defer { stateLock.unlock() }
    let modelDescription: Any = litertContext?.modelDescription ?? llamaContext?.modelDescription ?? NSNull()
    return [
      "platform": "ios",
      "runtime": currentRuntimeName(),
      "accelerator": loadedLiteRTOptions?.accelerator ?? loadedOptions?.accelerator ?? "cpu",
      "supportsAudio": false,
      "loadedModelId": loadedModelId as Any,
      "modelDescription": modelDescription,
      "systemInfo": IosLlamaContext.systemInfo()
    ]
  }

  func logMemorySnapshot(label: String) {
    let usedMb = residentMemoryBytes() / 1024 / 1024
    NSLog("[CaremindGemma] MEM[\(label)] resident=\(usedMb)MB loadedModel=\(loadedModelId ?? "none") runtime=\(currentRuntimeName())")
  }

  private func releaseLocked() {
    llamaContext = nil
    litertContext = nil
    loadedModelId = nil
    loadedOptions = nil
    loadedLiteRTOptions = nil
  }

  private func currentRuntimeName() -> String {
    if isStubModeEnabled {
      return "stub"
    }
    if litertContext != nil {
      return "litert-lm"
    }
    if llamaContext != nil {
      return "llama.cpp"
    }
    return "unloaded"
  }

  private static func isLiteRTModel(_ modelPath: String) -> Bool {
    modelPath.lowercased().hasSuffix(".litertlm")
  }

  private func isCancelled() -> Bool {
    cancelLock.lock()
    defer { cancelLock.unlock() }
    return cancelled
  }

  private func setCancelled(_ value: Bool) {
    cancelLock.lock()
    cancelled = value
    cancelLock.unlock()
  }

  private func residentMemoryBytes() -> UInt64 {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
      }
    }
    return result == KERN_SUCCESS ? UInt64(info.resident_size) : 0
  }

  fileprivate static let cancelledXml = "<caremind><guardrail><triggered>false</triggered><type>none</type></guardrail><boundary>已取消本地生成。</boundary></caremind>"
}

#if canImport(CLiteRTLM)
final class IosLiteRTLMContext {
  private let engine: Engine
  private let loadOptions: IosLiteRTLoadOptions
  private let activeConversationLock = NSLock()
  private var activeConversation: Conversation?
  let modelDescription: String

  init(modelPath: String, options: IosLiteRTLoadOptions) async throws {
    loadOptions = options
    let config = try EngineConfig(
      modelPath: modelPath,
      backend: IosLiteRTLMContext.backend(for: options.backend),
      maxNumTokens: options.maxNumTokens,
      cacheDir: try IosLiteRTLMContext.cacheDirectory().path
    )
    engine = Engine(engineConfig: config)
    try await engine.initialize()
    modelDescription = "LiteRT-LM \(URL(fileURLWithPath: modelPath).lastPathComponent)"
  }

  func generate(prompt: String, options: IosLiteRTGenerateOptions) async throws -> IosGemmaGeneration {
    let sampler = try SamplerConfig(
      topK: options.topK,
      topP: options.topP,
      temperature: options.temperature
    )
    let conversation = try await engine.createConversation(
      with: ConversationConfig(samplerConfig: sampler)
    )

    activeConversationLock.lock()
    activeConversation = conversation
    activeConversationLock.unlock()
    defer {
      activeConversationLock.lock()
      activeConversation = nil
      activeConversationLock.unlock()
    }

    let response = try await conversation.sendMessage(Message(prompt))
    let text = response.toString
    return IosGemmaGeneration(text: text, tokenCount: max(1, text.count / 4))
  }

  func cancel() {
    activeConversationLock.lock()
    let conversation = activeConversation
    activeConversationLock.unlock()
    try? conversation?.cancel()
  }

  private static func backend(for requested: String) -> Backend {
    if requested == "CPU" {
      return .cpu()
    }
    return .gpu
  }

  private static func cacheDirectory() throws -> URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let directory = base.appendingPathComponent("CareMind", isDirectory: true)
      .appendingPathComponent("LiteRTLMCache", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutableURL = directory
    try mutableURL.setResourceValues(values)
    return directory
  }
}
#else
final class IosLiteRTLMContext {
  let modelDescription = "LiteRT-LM unavailable"

  init(modelPath _: String, options _: IosLiteRTLoadOptions) async throws {
    throw CaremindGemmaError.modelLoadFailed("LiteRT-LM Swift runtime 未链接，请确认 CLiteRTLM.xcframework 已被 CocoaPods 链接。")
  }

  func generate(prompt _: String, options _: IosLiteRTGenerateOptions) async throws -> IosGemmaGeneration {
    throw CaremindGemmaError.modelLoadFailed("LiteRT-LM Swift runtime 未链接。")
  }

  func cancel() {}
}
#endif

final class IosLlamaContext {
  private let model: OpaquePointer
  private let context: OpaquePointer
  private let vocab: OpaquePointer
  private let loadOptions: IosLlamaLoadOptions
  let modelDescription: String

  init(modelPath: String, options: IosLlamaLoadOptions) throws {
    IosLlamaBackend.ensureStarted()
    loadOptions = options

    var modelParams = llama_model_default_params()
    modelParams.n_gpu_layers = options.gpuLayers
    modelParams.use_mmap = true

    guard let loadedModel = modelPath.withCString({ llama_model_load_from_file($0, modelParams) }) else {
      throw CaremindGemmaError.modelLoadFailed("无法打开 GGUF 文件，请确认模型格式为 llama.cpp GGUF。")
    }
    model = loadedModel

    var contextParams = llama_context_default_params()
    contextParams.n_ctx = options.contextTokens
    contextParams.n_batch = options.contextTokens
    contextParams.n_ubatch = min(options.contextTokens, 512)
    let threads = max(1, min(8, ProcessInfo.processInfo.processorCount - 2))
    contextParams.n_threads = Int32(threads)
    contextParams.n_threads_batch = Int32(threads)

    guard let loadedContext = llama_init_from_model(loadedModel, contextParams) else {
      llama_model_free(loadedModel)
      throw CaremindGemmaError.contextInitFailed
    }
    context = loadedContext

    guard let loadedVocab = llama_model_get_vocab(loadedModel) else {
      llama_free(loadedContext)
      llama_model_free(loadedModel)
      throw CaremindGemmaError.contextInitFailed
    }
    vocab = loadedVocab
    modelDescription = IosLlamaContext.describe(model: loadedModel)
  }

  deinit {
    llama_free(context)
    llama_model_free(model)
  }

  func generate(
    prompt: String,
    options: IosLlamaGenerateOptions,
    isCancelled: () -> Bool
  ) throws -> IosGemmaGeneration {
    llama_memory_clear(llama_get_memory(context), true)
    let promptTokens = try tokenize(prompt, addBos: true)
    let contextTokens = Int(llama_n_ctx(context))
    guard promptTokens.count + 2 < contextTokens else {
      throw CaremindGemmaError.promptTooLong(promptTokens.count, contextTokens)
    }

    let maxNewTokens = min(options.maxNewTokens, max(1, contextTokens - promptTokens.count - 2))
    var batch = llama_batch_init(Int32(max(promptTokens.count, 1)), 0, 1)
    defer { llama_batch_free(batch) }

    llamaBatchClear(&batch)
    for (idx, token) in promptTokens.enumerated() {
      llamaBatchAdd(&batch, token, Int32(idx), [0], idx == promptTokens.count - 1)
    }

    guard llama_decode(context, batch) == 0 else {
      throw CaremindGemmaError.inferenceFailed("prompt decode failed")
    }

    guard let sampler = makeSampler(options) else {
      throw CaremindGemmaError.inferenceFailed("sampler init failed")
    }
    defer { llama_sampler_free(sampler) }

    var generatedText = ""
    var utf8Buffer: [CChar] = []
    var generatedTokens = 0
    var currentPosition = Int32(promptTokens.count)

    while generatedTokens < maxNewTokens {
      if isCancelled() {
        return IosGemmaGeneration(text: IosGemmaEngine.cancelledXml, tokenCount: generatedTokens)
      }

      let nextToken = llama_sampler_sample(sampler, context, -1)
      if llama_vocab_is_eog(vocab, nextToken) {
        break
      }

      if let piece = tokenToPiece(nextToken, buffer: &utf8Buffer) {
        generatedText += piece
      }

      llamaBatchClear(&batch)
      llamaBatchAdd(&batch, nextToken, currentPosition, [0], true)
      currentPosition += 1
      generatedTokens += 1

      guard llama_decode(context, batch) == 0 else {
        throw CaremindGemmaError.inferenceFailed("token decode failed")
      }
    }

    return IosGemmaGeneration(text: generatedText, tokenCount: generatedTokens)
  }

  static func systemInfo() -> String {
    guard let info = llama_print_system_info() else {
      return ""
    }
    return String(cString: info)
  }

  private func makeSampler(_ options: IosLlamaGenerateOptions) -> UnsafeMutablePointer<llama_sampler>? {
    let sampler = llama_sampler_chain_init(llama_sampler_chain_default_params())
    guard let sampler else {
      return nil
    }
    llama_sampler_chain_add(sampler, llama_sampler_init_top_k(options.topK))
    llama_sampler_chain_add(sampler, llama_sampler_init_temp(options.temperature))
    llama_sampler_chain_add(sampler, llama_sampler_init_dist(UInt32.random(in: 1...UInt32.max)))
    return sampler
  }

  private func tokenize(_ text: String, addBos: Bool) throws -> [llama_token] {
    let utf8Count = text.utf8.count
    var capacity = max(8, utf8Count + (addBos ? 1 : 0) + 8)
    var tokens = [llama_token](repeating: 0, count: capacity)

    var tokenCount = text.withCString {
      llama_tokenize(vocab, $0, Int32(utf8Count), &tokens, Int32(tokens.count), addBos, true)
    }
    if tokenCount < 0 {
      capacity = Int(-tokenCount)
      tokens = [llama_token](repeating: 0, count: capacity)
      tokenCount = text.withCString {
        llama_tokenize(vocab, $0, Int32(utf8Count), &tokens, Int32(tokens.count), addBos, true)
      }
    }

    guard tokenCount > 0 else {
      throw CaremindGemmaError.tokenizationFailed
    }
    return Array(tokens.prefix(Int(tokenCount)))
  }

  private func tokenToPiece(_ token: llama_token, buffer: inout [CChar]) -> String? {
    var piece = [CChar](repeating: 0, count: 16)
    var count = llama_token_to_piece(vocab, token, &piece, Int32(piece.count), 0, false)
    if count < 0 {
      piece = [CChar](repeating: 0, count: Int(-count))
      count = llama_token_to_piece(vocab, token, &piece, Int32(piece.count), 0, false)
    }
    guard count > 0 else {
      return nil
    }

    let bytes = piece.prefix(Int(count)).map { UInt8(bitPattern: $0) }
    if buffer.isEmpty, let text = String(data: Data(bytes), encoding: .utf8) {
      return text
    }

    buffer.append(contentsOf: piece.prefix(Int(count)))
    let bufferedBytes = buffer.map { UInt8(bitPattern: $0) }
    guard let text = String(data: Data(bufferedBytes), encoding: .utf8) else {
      if buffer.count > 8 {
        buffer.removeAll()
      }
      return nil
    }
    buffer.removeAll()
    return text
  }

  private static func describe(model: OpaquePointer) -> String {
    var buffer = [CChar](repeating: 0, count: 256)
    let count = llama_model_desc(model, &buffer, buffer.count)
    guard count > 0 else {
      return "llama.cpp model"
    }
    let bytes = buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }
    return String(decoding: bytes, as: UTF8.self)
  }
}

enum IosLlamaBackend {
  private static let lock = NSLock()
  nonisolated(unsafe) private static var started = false

  static func ensureStarted() {
    lock.lock()
    defer { lock.unlock() }
    guard !started else {
      return
    }
    llama_backend_init()
    started = true
  }
}

private func llamaBatchClear(_ batch: inout llama_batch) {
  batch.n_tokens = 0
}

private func llamaBatchAdd(
  _ batch: inout llama_batch,
  _ token: llama_token,
  _ position: llama_pos,
  _ sequenceIds: [llama_seq_id],
  _ logits: Bool
) {
  let index = Int(batch.n_tokens)
  batch.token[index] = token
  batch.pos[index] = position
  batch.n_seq_id[index] = Int32(sequenceIds.count)
  for (offset, sequenceId) in sequenceIds.enumerated() {
    batch.seq_id[index]![offset] = sequenceId
  }
  batch.logits[index] = logits ? 1 : 0
  batch.n_tokens += 1
}

final class IosGemmaStubResponder {
  func generate(prompt: String) -> String {

    let note = extractUserNote(from: prompt)
    let nightWakings = extractNightWakings(note)
    let hasMeal = containsAny(note, ["饭", "吃", "食欲", "饮水", "呛咳"])
    let hasMedication = containsAny(note, ["药", "服药", "拒药", "漏药", "补药"])
    let hasCaregiver = containsAny(note, ["撑不住", "很累", "崩溃", "没睡", "烦躁", "压力"])
    let acute = containsAny(note, ["失踪", "走失", "自伤", "伤人", "呼吸困难", "胸痛", "意识"])
    let attentionType = acute ? "night_safety" : hasMedication ? "medication" : hasMeal ? "nutrition" : hasCaregiver ? "caregiver" : "behavior"
    let severity = acute ? "crisis" : hasCaregiver ? "high" : nightWakings >= 3 ? "high" : "medium"

    return """
    <caremind>
      <structured_log>
        <sleep>
          <night_wakings>\(nightWakings >= 0 ? String(nightWakings) : "")</night_wakings>
          <note>\(escapeXml(nightWakings >= 0 ? "记录到夜间起床 \(nightWakings) 次。" : "未提到夜间起床次数。"))</note>
        </sleep>
        <behavior>
          <item>
            <label>\(escapeXml(behaviorLabel(note)))</label>
            <frequency>待确认</frequency>
            <evidence>\(escapeXml(note))</evidence>
          </item>
        </behavior>
        <nutrition>
          <meal_intake>\(containsAny(note, ["几口", "很少", "吃得少"]) ? "few_bites" : "unknown")</meal_intake>
          <water_intake>unknown</water_intake>
          <choking>\(containsAny(note, ["呛咳", "呛到"]) ? "true" : "unknown")</choking>
          <weight_change>unknown</weight_change>
          <note>\(escapeXml(hasMeal ? "提到饮食或饮水变化，建议补充具体摄入量。" : "未提到饮食变化。"))</note>
        </nutrition>
        <medication>
          <mentioned>\(hasMedication ? "true" : "false")</mentioned>
          <refusal_count></refusal_count>
          <missed_dose>\(containsAny(note, ["漏药", "漏服", "没吃药"]) ? "true" : "unknown")</missed_dose>
          <duplicate_dose>unknown</duplicate_dose>
          <medication_names></medication_names>
          <note>\(escapeXml(hasMedication ? "提到服药、拒药或漏药相关情况，建议记录发生时间和场景。" : "未提到服药变化。"))</note>
        </medication>
        <safety>
          <night_wandering>\(nightWakings >= 0 ? "true" : "unknown")</night_wandering>
          <door_exit_attempt>\(containsAny(note, ["开门", "出去", "外出"]) ? "true" : "unknown")</door_exit_attempt>
          <fall>\(containsAny(note, ["跌倒", "摔"]) ? "true" : "unknown")</fall>
          <wandering>\(containsAny(note, ["走失", "迷路"]) ? "true" : "unknown")</wandering>
          <acute_danger>\(acute ? "true" : "false")</acute_danger>
          <note>\(escapeXml(acute ? "记录中出现急性危险信号，请优先联系线下紧急支持。" : "请继续记录具体时间、场景和已尝试做法。"))</note>
        </safety>
        <caregiver>
          <quote>\(escapeXml(hasCaregiver ? "记录到照护者压力表达" : ""))</quote>
          <stress_level>\(hasCaregiver ? "high" : "low")</stress_level>
        </caregiver>
      </structured_log>
      <attention_items>
        <item>
          <type>\(attentionType)</type>
          <severity>\(severity)</severity>
          <title>\(escapeXml(titleForAttention(attentionType)))</title>
          <evidence>\(escapeXml(note.isEmpty ? "本机备用模式未提取到原始记录。" : note))</evidence>
          <doctor_feedback_hint>如持续出现，建议复诊时告知医生。</doctor_feedback_hint>
          <actions>
            <action>
              <label>\(escapeXml(actionForAttention(attentionType)))</label>
              <alternative_label>如果今天做不到，先记录事实，晚点再补充。</alternative_label>
            </action>
          </actions>
        </item>
      </attention_items>
      <memory_candidates></memory_candidates>
      <communication_script>
        <not_recommended>不要争辩、责备或直接否定对方感受。</not_recommended>
        <recommended>先接住情绪，再给一个简单、可执行的下一步。</recommended>
        <principle>保持温和、短句、低冲突。</principle>
      </communication_script>
      <guardrail>
        <triggered>\(acute ? "true" : "false")</triggered>
        <type>\(acute ? "crisis" : "none")</type>
        <message>\(escapeXml(acute ? "记录中出现急性危险信号，建议立刻联系当地紧急服务或医生。" : ""))</message>
      </guardrail>
      <boundary>以上为 iPhone 本机备用整理结果，不是诊断、处方或检查建议。</boundary>
    </caremind>
    """
  }

  private func extractUserNote(from prompt: String) -> String {
    let markers = ["照护记录：", "原始记录：", "用户记录：", "记录："]
    for marker in markers {
      if let range = prompt.range(of: marker) {
        let suffix = String(prompt[range.upperBound...])
        return suffix
          .components(separatedBy: "\n")
          .first?
          .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      }
    }
    return prompt.components(separatedBy: "\n").last?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  private func extractNightWakings(_ note: String) -> Int {
    let mapping: [(String, Int)] = [
      ("一次", 1), ("1次", 1), ("两次", 2), ("二次", 2), ("2次", 2),
      ("三次", 3), ("3次", 3), ("四次", 4), ("4次", 4),
      ("五次", 5), ("5次", 5), ("六次", 6), ("6次", 6)
    ]
    if containsAny(note, ["夜", "半夜", "起床", "醒"]) {
      for (token, value) in mapping where note.contains(token) {
        return value
      }
    }
    return -1
  }

  private func containsAny(_ text: String, _ tokens: [String]) -> Bool {
    tokens.contains { text.contains($0) }
  }

  private func behaviorLabel(_ note: String) -> String {
    if containsAny(note, ["偷钱", "被偷"]) { return "怀疑东西被偷" }
    if containsAny(note, ["回家", "老家"]) { return "反复想回家" }
    if containsAny(note, ["烦躁", "生气", "激动"]) { return "情绪激动" }
    return "一般照护观察"
  }

  private func titleForAttention(_ type: String) -> String {
    switch type {
    case "night_safety":
      return "今晚留意夜间安全"
    case "nutrition":
      return "今天关注饮食和饮水"
    case "medication":
      return "记录服药相关变化"
    case "caregiver":
      return "今天也要照顾你自己"
    default:
      return "记录并观察变化"
    }
  }

  private func actionForAttention(_ type: String) -> String {
    switch type {
    case "night_safety":
      return "睡前确认门锁、夜灯和床边动线"
    case "nutrition":
      return "记录今天大概吃了多少、喝了多少"
    case "medication":
      return "记录服药发生时间和场景"
    case "caregiver":
      return "今晚只保留安全和基本照护目标"
    default:
      return "补充发生时间、场景和已尝试做法"
    }
  }

  private func escapeXml(_ value: String) -> String {
    value
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
      .replacingOccurrences(of: "'", with: "&apos;")
  }
}
