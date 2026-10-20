package com.lifeos.app.ui.connect

import android.content.Context
import androidx.annotation.OptIn
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.lifeos.app.ui.theme.palette
import java.util.concurrent.Executors

/**
 * The viewfinder (UI_SPEC §7.3).
 *
 * CameraX for the camera and ML Kit's **bundled** barcode model for the decode,
 * which is the combination the spec names and the reason it names it: the model
 * is inside the APK, so the first run of a freshly installed app scans
 * immediately with no network and no Play Services download — and pairing is the
 * one moment when the phone provably cannot reach Life OS yet.
 *
 * Two things here are deliberate and easy to get wrong:
 *
 *  - **The camera is bound to the composition's lifecycle**, so leaving the
 *    screen releases the device. A camera left bound is a green dot in the
 *    status bar on a habit tracker, which is exactly the kind of thing that gets
 *    an app distrusted.
 *  - **`onCode` can fire many times a second.** The analyser sees every frame
 *    and a QR in shot decodes in most of them. The caller decides what to do
 *    with a repeat — `PairViewModel` ignores everything once a claim is in
 *    flight, because the code is single-use and a second claim of a burnt code
 *    would answer `401` and overwrite a success with a failure.
 */
@Composable
fun QrScanner(onCode: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val p = palette

    /*
     * `rememberUpdatedState` because the analyser is wired up once, inside a
     * `DisposableEffect`, and would otherwise hold the first composition's
     * lambda for as long as the camera lives.
     */
    val latest by rememberUpdatedState(onCode)

    val scanner: BarcodeScanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                // QR only. Every other symbology is a format the model has to
                // try and nothing in this product can read.
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build(),
        )
    }

    val previewView = remember {
        PreviewView(context).apply {
            // FIT_CENTER rather than the default FILL_CENTER: a cropped preview
            // shows less than the sensor is decoding, so a QR can be read while
            // appearing to be outside the frame — or appear inside it and not be.
            scaleType = PreviewView.ScaleType.FIT_CENTER
        }
    }

    DisposableEffect(lifecycleOwner, previewView) {
        val executor = Executors.newSingleThreadExecutor()
        var provider: ProcessCameraProvider? = null

        val future = ProcessCameraProvider.getInstance(context)
        future.addListener(
            {
                val cameraProvider = runCatching { future.get() }.getOrNull()
                    ?: return@addListener
                provider = cameraProvider

                val preview = Preview.Builder().build()
                preview.setSurfaceProvider(previewView.surfaceProvider)

                val analysis = ImageAnalysis.Builder()
                    // Drop frames rather than queue them: a backlog would decode
                    // the code the phone was pointing at a second ago.
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                analysis.setAnalyzer(executor) { proxy ->
                    analyse(proxy = proxy, scanner = scanner, onCode = { latest(it) })
                }

                runCatching {
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                }
            },
            ContextCompat.getMainExecutor(context),
        )

        onDispose {
            provider?.unbindAll()
            executor.shutdown()
            scanner.close()
        }
    }

    Box(modifier = modifier) {
        AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())

        /*
         * The frame. A scrim everywhere but a centred square, and four accent
         * corners on it — the square is where to put the code, and the corners
         * say so without a sentence. Drawn rather than composed because it is
         * one path subtracted from another, which is a draw, not a layout.
         */
        Canvas(modifier = Modifier.fillMaxSize()) {
            val side = minOf(size.width, size.height) * 0.68f
            val left = (size.width - side) / 2f
            val top = (size.height - side) / 2f
            val radius = CornerRadius(24.dp.toPx(), 24.dp.toPx())

            val window = Path().apply {
                addRoundRect(
                    androidx.compose.ui.geometry.RoundRect(
                        left = left,
                        top = top,
                        right = left + side,
                        bottom = top + side,
                        cornerRadius = radius,
                    ),
                )
            }
            val scrim = Path().apply {
                addRect(androidx.compose.ui.geometry.Rect(Offset.Zero, size))
                op(this, window, PathOperation.Difference)
            }
            drawPath(scrim, color = Color.Black.copy(alpha = 0.55f))

            // The corners: four short strokes, not a full outline. An outline
            // around a live camera reads as a border on a photograph.
            val arm = side * 0.14f
            val stroke = Stroke(width = 3.dp.toPx())
            listOf(
                Offset(left, top) to Offset(1f, 1f),
                Offset(left + side, top) to Offset(-1f, 1f),
                Offset(left, top + side) to Offset(1f, -1f),
                Offset(left + side, top + side) to Offset(-1f, -1f),
            ).forEach { (corner, direction) ->
                drawPath(
                    path = Path().apply {
                        moveTo(corner.x + direction.x * arm, corner.y)
                        lineTo(corner.x, corner.y)
                        lineTo(corner.x, corner.y + direction.y * arm)
                    },
                    color = p.accent,
                    style = stroke,
                )
            }
            // A hairline on the window itself, at low alpha, so the square has
            // an edge in a dark room where the scrim alone shows nothing.
            drawRoundRect(
                color = p.text.copy(alpha = 0.18f),
                topLeft = Offset(left, top),
                size = Size(side, side),
                cornerRadius = radius,
                style = Stroke(width = 1.dp.toPx()),
            )
        }
    }
}

/**
 * One frame.
 *
 * `proxy.close()` on **every** path, including the failures — an unclosed
 * `ImageProxy` stalls the analyser after two frames and the preview appears to
 * freeze with no error anywhere.
 */
@OptIn(ExperimentalGetImage::class)
private fun analyse(
    proxy: androidx.camera.core.ImageProxy,
    scanner: BarcodeScanner,
    onCode: (String) -> Unit,
) {
    val image = proxy.image
    if (image == null) {
        proxy.close()
        return
    }
    val input = InputImage.fromMediaImage(image, proxy.imageInfo.rotationDegrees)
    scanner.process(input)
        .addOnSuccessListener { codes ->
            codes.firstNotNullOfOrNull { it.rawValue?.takeIf { value -> value.isNotBlank() } }
                ?.let(onCode)
        }
        .addOnCompleteListener { proxy.close() }
}

/** Whether the camera permission is already granted, without asking for it. */
fun hasCameraPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, android.Manifest.permission.CAMERA) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED
