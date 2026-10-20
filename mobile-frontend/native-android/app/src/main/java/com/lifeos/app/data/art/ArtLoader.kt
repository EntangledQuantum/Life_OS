package com.lifeos.app.data.art

import android.content.Context
import coil3.ComponentRegistry
import coil3.ImageLoader
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.disk.DiskCache
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.SourceFetchResult
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.Options
import coil3.svg.SvgDecoder
import com.lifeos.app.data.TokenSource
import com.lifeos.app.domain.ArtSvg
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okio.Buffer
import okio.FileSystem
import okio.Path.Companion.toOkioPath
import java.util.concurrent.TimeUnit

/**
 * The one image loader in the app.
 *
 * Three things about it are not negotiable, and all three are the reason it is
 * built by hand rather than left to Coil's defaults:
 *
 *  1. **It phones nowhere by itself.** Coil's network layer is replaced with
 *     this app's own OkHttp client, so an image request has the same bounded
 *     timeouts as every other request and reaches exactly the hosts an agent
 *     put in a URL — there is no CDN, no placeholder service, no telemetry and
 *     no crash reporter anywhere in this graph.
 *  2. **The token goes to the user's server and to nothing else.** A picture
 *     hosted on the user's own Life OS needs the bearer header or it comes back
 *     `401`; a picture an agent linked from somewhere else must never see it.
 *     [ArtOrigin] is the switch, and it compares scheme, host and port.
 *  3. **Nothing is ever logged.** No logging interceptor at any build type, for
 *     the same reason `ApiClient` has none: a request log carries the
 *     `Authorization` header.
 */
object ArtLoader {

    /** Matches `ApiClient`: nothing is unbounded, ever. A picture is not urgent. */
    private const val CONNECT_SECONDS = 5L
    private const val READ_SECONDS = 20L
    private const val CALL_SECONDS = 30L

    /**
     * A fifth of the app's heap for decoded bitmaps.
     *
     * This cache is what makes the eight-second poll free: the key is short (see
     * `Art.cacheKey`), so a poll that returns the same picture is a map lookup
     * rather than a base64 walk and a bitmap decode.
     */
    private const val MEMORY_PERCENT = 0.20

    /** 48 MB on disk, so a cold start draws yesterday's art with no network. */
    private const val DISK_BYTES = 48L * 1024 * 1024

    private const val DISK_DIR = "art_images"

    fun create(context: Context, tokens: TokenSource, origin: ArtOrigin): ImageLoader =
        ImageLoader.Builder(context)
            .components(components(tokens, origin))
            .memoryCache {
                MemoryCache.Builder().maxSizePercent(context, MEMORY_PERCENT).build()
            }
            .diskCache {
                /*
                 * Only network results land here — a `data:` URI is already in
                 * the dashboard snapshot that Room holds, so it survives a cold
                 * start by a different route and writing it twice would be the
                 * same bytes in two places.
                 */
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve(DISK_DIR).toOkioPath())
                    .maxSizeBytes(DISK_BYTES)
                    .build()
            }
            .build()

    private fun components(tokens: TokenSource, origin: ArtOrigin): ComponentRegistry =
        ComponentRegistry.Builder()
            // An agent's SVG, decoded to a bitmap. `ArtSvg` is its own model
            // type so nothing else in the app can route markup anywhere near a
            // renderer that could execute it.
            .add(ArtSvgFetcher.Factory(), ArtSvg::class)
            .add(SvgDecoder.Factory())
            .add(OkHttpNetworkFetcherFactory(callFactory = { okHttp(tokens, origin) }))
            .build()

    private fun okHttp(tokens: TokenSource, origin: ArtOrigin): OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(CONNECT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_SECONDS, TimeUnit.SECONDS)
            .callTimeout(CALL_SECONDS, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .addInterceptor(sameOriginAuth(tokens, origin))
            // Deliberately no logging interceptor. See the note above.
            .build()

    /**
     * Bearer auth for the user's own server, and for no other host.
     *
     * The comparison is scheme + host + port, parsed — never a prefix match on
     * the text. A configured `http://192.168.1.4:8787` must not authorise a URL
     * that merely *starts* with it, and a prefix test is exactly how a
     * lookalike host gets handed the token.
     */
    private fun sameOriginAuth(tokens: TokenSource, origin: ArtOrigin) = Interceptor { chain ->
        val request = chain.request()
        val token = if (origin.matches(request.url.toString())) tokens.token() else null
        chain.proceed(
            if (token.isNullOrBlank()) request
            else request.newBuilder().header("Authorization", "Bearer $token").build(),
        )
    }
}

/**
 * Which origin an image request may carry the token to.
 *
 * A plain mutable mirror of the configured address, because an OkHttp
 * interceptor runs on a network thread and must not block on DataStore — and
 * `AppPreferences.baseUrl()` is a `suspend` read. The process keeps this in step
 * (see `LifeOsApp`); "Change server" therefore takes effect on images at the
 * same moment it takes effect on requests.
 */
class ArtOrigin {

    @Volatile
    private var origin: String? = null

    /** Called with whatever is in preferences, including null on a disconnect. */
    fun set(baseUrl: String?) {
        origin = baseUrl?.toHttpUrlOrNull()?.let { "${it.scheme}://${it.host}:${it.port}" }
    }

    fun matches(url: String): Boolean {
        val mine = origin ?: return false
        val parsed = url.toHttpUrlOrNull() ?: return false
        return "${parsed.scheme}://${parsed.host}:${parsed.port}" == mine
    }
}

/**
 * Hands an [ArtSvg]'s markup to the SVG decoder as bytes, and nothing else.
 *
 * `DataSource.MEMORY` because the markup arrived in the dashboard payload; there
 * is no fetch here, which is the point — the "source" of an agent's vector is a
 * string the app already has, so this cannot make a request even in principle.
 *
 * The mime type is stated rather than sniffed so that `SvgDecoder` is the only
 * decoder that can ever claim it.
 */
internal class ArtSvgFetcher(private val art: ArtSvg) : Fetcher {

    override suspend fun fetch(): FetchResult = SourceFetchResult(
        source = ImageSource(
            source = Buffer().apply { writeUtf8(art.svg) },
            fileSystem = FileSystem.SYSTEM,
        ),
        mimeType = MIME,
        dataSource = DataSource.MEMORY,
    )

    class Factory : Fetcher.Factory<ArtSvg> {
        override fun create(data: ArtSvg, options: Options, imageLoader: ImageLoader): Fetcher =
            ArtSvgFetcher(data)
    }

    private companion object {
        const val MIME = "image/svg+xml"
    }
}
