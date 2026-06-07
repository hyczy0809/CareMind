package com.caremind.app.gemma

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
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
 * Both `.litertlm` (LiteRT-LM) and `.task` (MediaPipe Task Bundle) formats
 * are supported by `com.google.mediapipe:tasks-genai` — `setModelPath()`
 * inspects file contents, not the extension.
 */
class GemmaModelDownloader(private val context: Context) {
    private val maxAttempts = 4

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

    fun targetFile(filename: String): File {
        require(isSafeFilename(filename)) { "非法的模型文件名：$filename" }
        return File(modelDir(), filename)
    }

    private fun partFile(filename: String): File =
        File(modelDir(), "$filename.part")

    fun isReady(filename: String): Boolean {
        val file = targetFile(filename)
        return file.exists() && file.length() > 0
    }

    fun delete(filename: String) {
        targetFile(filename).takeIf { it.exists() }?.delete()
        partFile(filename).takeIf { it.exists() }?.delete()
    }

    @Throws(IOException::class)
    fun download(
        filename: String,
        url: String,
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

            val responseCode = connection.responseCode
            if (existingBytes > 0 && responseCode == HttpURLConnection.HTTP_OK) {
                // Server ignored Range; restart cleanly to avoid corrupt output.
                part.delete()
            }
            if (responseCode !in 200..299) {
                connection.disconnect()
                throw IOException("模型下载失败：HTTP $responseCode")
            }

            val resumed = existingBytes > 0 && responseCode == HttpURLConnection.HTTP_PARTIAL
            val downloadedOffset = if (resumed) existingBytes else 0L
            val contentLength = connection.contentLengthLong.coerceAtLeast(0L)
            val totalBytes = when {
                resumed && contentLength > 0 -> downloadedOffset + contentLength
                contentLength > 0 -> contentLength
                expectedTotalBytes > 0 -> expectedTotalBytes
                else -> 0L
            }
            expectedTotalBytes = totalBytes
            var downloaded = downloadedOffset

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

                if (expectedTotalBytes > 0 && downloaded < expectedTotalBytes) {
                    throw IOException("模型下载未完成：$downloaded / $expectedTotalBytes")
                }

                if (target.exists()) target.delete()
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
