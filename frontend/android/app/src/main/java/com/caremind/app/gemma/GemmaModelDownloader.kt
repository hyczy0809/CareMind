package com.caremind.app.gemma

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.StatFs
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Stream-downloads on-device LLM weight files into the app's private
 * filesDir, one file per model name. Multiple models can coexist on disk;
 * the active model is chosen by the JS side via a filename argument.
 *
 * Writes to `<name>.part` and atomically renames on completion, so partial
 * downloads never look "ready". Cancellation is cooperative per filename.
 *
 * CareMind's Android privacy mode now runs Gemma 4 through LiteRT-LM, so only
 * `.litertlm` model bundles are accepted by the native runtime.
 */
class GemmaModelDownloader(private val context: Context) {
    private val tag = "CaremindGemmaModel"
    private val maxAttempts = 4
    private val minFreeBytesAfterDownload = 512L * 1024L * 1024L

    /** Per-filename cancel flags so cancelling one download does not affect
     *  unrelated downloads (rare but cleaner). */
    private val cancelFlags = ConcurrentHashMap<String, AtomicBoolean>()

    private fun cancelFlagFor(filename: String): AtomicBoolean =
        cancelFlags.getOrPut(filename) { AtomicBoolean(false) }

    fun cancel(filename: String) {
        cancelFlagFor(filename).set(true)
    }

    fun resetCancel(filename: String) {
        cancelFlagFor(filename).set(false)
    }

    private fun modelDir(): File {
        val dir = File(context.filesDir, "llm")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    fun appPrivateTargetFile(filename: String): File {
        require(isSafeFilename(filename)) { "非法的模型文件名：$filename" }
        return File(modelDir(), filename)
    }

    fun targetFile(filename: String): File {
        require(isSafeFilename(filename)) { "非法的模型文件名：$filename" }
        val appPrivateFile = appPrivateTargetFile(filename)
        val devFile = debugTmpModelFile()
        if (shouldUseDebugTmpModel(filename, devFile)) {
            Log.i(tag, "Using debug tmp model path=${devFile.absolutePath} for filename=$filename")
            return devFile
        }
        Log.i(tag, "Using app model path=${appPrivateFile.absolutePath} for filename=$filename")
        return appPrivateFile
    }

    private fun partFile(filename: String): File =
        File(modelDir(), "$filename.part")

    fun isReady(filename: String): Boolean {
        val file = targetFile(filename)
        return file.exists() && file.length() > 0
    }

    fun delete(filename: String) {
        val target = targetFile(filename)
        if (isDebugTmpModel(target)) {
            Log.i(tag, "Skipping delete for debug tmp model path=${target.absolutePath}")
        } else {
            target.takeIf { it.exists() }?.delete()
        }
        partFile(filename).takeIf { it.exists() }?.delete()
    }

    private fun shouldUseDebugTmpModel(filename: String, devFile: File): Boolean {
        if (!isDebuggable()) return false
        if (!filename.lowercase().endsWith(".litertlm")) return false
        return devFile.exists() && devFile.length() > 0
    }

    private fun isDebuggable(): Boolean =
        (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    fun debugTmpModelFile(): File =
        File("/data/local/tmp/llm/gemma.litertlm")

    fun isDebugTmpModel(file: File): Boolean =
        file.absolutePath == debugTmpModelFile().absolutePath

    @Throws(IOException::class)
    fun copyDebugModelIntoAppPrivate(filename: String): File {
        val source = debugTmpModelFile()
        if (!source.exists() || source.length() <= 0L) {
            throw IOException("未找到调试模型：${source.absolutePath}")
        }
        if (source.extension.lowercase(Locale.US) != "litertlm") {
            throw IOException("调试模型格式不支持：.${source.extension}")
        }
        val target = appPrivateTargetFile(filename)
        target.parentFile?.let { parent ->
            if (!parent.exists()) parent.mkdirs()
        }
        source.inputStream().use { input ->
            FileOutputStream(target, false).use { output ->
                val buffer = ByteArray(1024 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    output.write(buffer, 0, read)
                }
                output.flush()
            }
        }
        return target
    }

    @Throws(IOException::class)
    fun download(
        filename: String,
        url: String,
        checksumSha256: String?,
        expectedBytes: Long?,
        progressListener: (bytesDownloaded: Long, totalBytes: Long) -> Unit
    ): File {
        resetCancel(filename)
        val target = targetFile(filename)
        val part = partFile(filename)
        val cancelFlag = cancelFlagFor(filename)
        var expectedTotalBytes = 0L
        var lastError: IOException? = null

        for (attempt in 1..maxAttempts) {
            if (cancelFlag.get()) throw IOException("下载已取消")

            val existingBytes = part.takeIf { it.exists() }?.length() ?: 0L
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 30_000
                readTimeout = 120_000
                instanceFollowRedirects = true
                requestMethod = "GET"
                if (existingBytes > 0) {
                    setRequestProperty("Range", "bytes=$existingBytes-")
                }
            }

            val responseCode = try {
                connection.responseCode
            } catch (t: SocketTimeoutException) {
                connection.disconnect()
                throw IOException("模型下载超时：网络连接或服务器响应太慢，请保持网络稳定后重试。", t)
            } catch (t: UnknownHostException) {
                connection.disconnect()
                throw IOException("模型下载失败：无法连接到下载服务器，请检查网络或 DNS。", t)
            }
            val contentLength = connection.contentLengthLong.coerceAtLeast(0L)
            Log.i(
                tag,
                "download attempt model=$filename host=${urlHost(connection.url)} status=$responseCode contentLength=$contentLength retry=${attempt - 1}"
            )
            if (existingBytes > 0 && responseCode == HttpURLConnection.HTTP_OK) {
                // Server ignored Range; restart cleanly to avoid corrupt output.
                part.delete()
            }
            if (responseCode !in 200..299) {
                val message = httpErrorMessage(responseCode)
                connection.disconnect()
                if (responseCode >= 500 && attempt < maxAttempts) {
                    lastError = IOException(message)
                    Thread.sleep((attempt * 1500L).coerceAtMost(6000L))
                    continue
                }
                throw IOException(message)
            }

            val resumed = existingBytes > 0 && responseCode == HttpURLConnection.HTTP_PARTIAL
            val downloadedOffset = if (resumed) existingBytes else 0L
            val totalBytes = when {
                expectedBytes != null && expectedBytes > 0L -> expectedBytes
                resumed && contentLength > 0 -> downloadedOffset + contentLength
                contentLength > 0 -> contentLength
                expectedTotalBytes > 0 -> expectedTotalBytes
                else -> 0L
            }
            expectedTotalBytes = totalBytes
            var downloaded = downloadedOffset
            if (totalBytes > 0) {
                assertEnoughDiskSpace(part.parentFile ?: modelDir(), totalBytes - downloadedOffset)
            }

            try {
                connection.inputStream.use { input ->
                    FileOutputStream(part, resumed).use { output ->
                        val buffer = ByteArray(256 * 1024)
                        var lastEmit = 0L
                        progressListener(downloaded, totalBytes)
                        while (true) {
                            if (cancelFlag.get()) {
                                throw IOException("下载已取消")
                            }
                            val read = input.read(buffer)
                            if (read <= 0) break
                            output.write(buffer, 0, read)
                            downloaded += read

                            val now = System.currentTimeMillis()
                            // Throttle progress events to roughly 8/sec.
                            if (now - lastEmit > 120) {
                                progressListener(downloaded, totalBytes)
                                lastEmit = now
                            }
                        }
                        output.flush()
                    }
                }
                // Final progress tick.
                progressListener(downloaded, if (totalBytes > 0) totalBytes else downloaded)

                val finalExpectedBytes = expectedBytes?.takeIf { it > 0L } ?: expectedTotalBytes
                if (finalExpectedBytes > 0 && downloaded != finalExpectedBytes) {
                    throw IOException("模型下载大小不完整：$downloaded / $finalExpectedBytes，请重新点击下载继续。")
                }

                if (target.exists()) target.delete()
                verifyChecksumIfPresent(part, checksumSha256)
                if (!part.renameTo(target)) {
                    throw IOException("下载完成但无法移动到最终路径。")
                }
                return target
            } catch (t: IOException) {
                lastError = t
                if (cancelFlag.get()) {
                    throw t
                }
                if (attempt == maxAttempts) {
                    throw t
                }
                Thread.sleep((attempt * 1500L).coerceAtMost(6000L))
            } finally {
                connection.disconnect()
            }
        }

        throw lastError ?: IOException("模型下载失败")
    }

    private fun httpErrorMessage(statusCode: Int): String =
        when (statusCode) {
            401, 403 -> "模型下载失败：HTTP $statusCode，模型源鉴权或许可未通过。"
            404 -> "模型下载失败：HTTP 404，模型文件不存在。"
            408, 504 -> "模型下载超时：HTTP $statusCode，请保持网络连接后重试。"
            in 500..599 -> "模型下载失败：服务器返回 HTTP $statusCode。"
            else -> "模型下载失败：HTTP $statusCode。"
        }

    private fun urlHost(url: URL?): String =
        try {
            url?.host ?: "unknown"
        } catch (_: Throwable) {
            "unknown"
        }

    private fun assertEnoughDiskSpace(directory: File, bytesRemaining: Long) {
        if (!directory.exists()) directory.mkdirs()
        val available = StatFs(directory.absolutePath).availableBytes
        val required = bytesRemaining + minFreeBytesAfterDownload
        if (available < required) {
            throw IOException(
                "手机剩余空间不足：还需要约 ${formatMb(required)}MB，可用约 ${formatMb(available)}MB。"
            )
        }
    }

    private fun verifyChecksumIfPresent(file: File, checksumSha256: String?) {
        val expected = checksumSha256?.trim()?.lowercase(Locale.US).orEmpty()
        if (expected.isBlank()) return
        if (!expected.matches(Regex("^[0-9a-f]{64}$"))) {
            throw IOException("模型校验值格式不正确。")
        }
        val actual = sha256(file)
        if (actual != expected) {
            file.delete()
            throw IOException("模型文件校验失败，请重新下载。")
        }
        Log.i(tag, "Checksum OK sha256=$actual file=${file.name}")
    }

    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun formatMb(bytes: Long): Long =
        bytes.coerceAtLeast(0L) / (1024L * 1024L)

    companion object {
        /** Reject path-traversal and absolute paths early. */
        fun isSafeFilename(name: String): Boolean {
            if (name.isBlank()) return false
            if (name.contains('/') || name.contains('\\')) return false
            if (name.startsWith("..")) return false
            return true
        }
    }
}
