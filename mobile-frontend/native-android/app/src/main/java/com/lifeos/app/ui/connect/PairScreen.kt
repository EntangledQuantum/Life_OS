package com.lifeos.app.ui.connect

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.lifeos.app.data.AppContainer
import com.lifeos.app.domain.PairInvite
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.components.PageBody
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.craftedSurface
import com.lifeos.app.ui.theme.palette

/**
 * QR pairing, for real (UI_SPEC §7.3).
 *
 * This route has two ways in and they share everything after the first line:
 *
 *  1. **The instructions.** No camera is opened here. The phone already scans
 *     QR codes, so this screen's job is to say so — 2.0.0's bug was a button
 *     announcing that scanning was unavailable, not a missing scanner.
 *  2. **The deep link.** The phone's own camera app, Google Lens or the
 *     dashboard's pair page fires `lifeos://pair?code=…&url=…` at the Activity,
 *     which parses it and hands the invite straight here — usually on a **cold
 *     start**, because the link is why the app is opening.
 *
 * Both end in `PairViewModel.submit`, so there is one claim, one token write and
 * one set of failure sentences.
 */
@Composable
fun PairRoute(
    container: AppContainer,
    /** An invite that arrived as a deep link, if one did. */
    invite: PairInvite?,
    onInviteRead: () -> Unit,
    onPaired: () -> Unit,
    onEnterManually: () -> Unit,
    onChangeServer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val vm: PairViewModel = viewModel(factory = PairViewModel.factory(container))
    val phase by vm.phase.collectAsStateWithLifecycle()

    // Cleared off the intent as soon as it is read, exactly as the notification
    // tap is, or every configuration change re-claims a code that is already
    // burnt and turns a success into "no longer valid".
    LaunchedEffect(invite) {
        val incoming = invite ?: return@LaunchedEffect
        vm.submit(incoming)
        onInviteRead()
    }

    LaunchedEffect(phase) {
        if (phase is PairPhase.Paired) onPaired()
    }

    when (val current = phase) {
        is PairPhase.Claiming -> ClaimingBlock(address = current.address, modifier = modifier)

        is PairPhase.Failed -> FailedBlock(
            message = current.message,
            changeServer = current.changeServer,
            onRescan = vm::rescan,
            onEnterManually = onEnterManually,
            onChangeServer = onChangeServer,
            modifier = modifier,
        )

        // Nothing to draw once it worked: the route is already leaving.
        PairPhase.Paired -> Box(modifier = modifier.fillMaxSize())

        PairPhase.Scanning -> ScanningBlock(
            onEnterManually = onEnterManually,
            modifier = modifier,
        )
    }
}

/**
 * Waiting for the QR, which the phone's own camera scans.
 *
 * There is **no scanner in this app, on purpose.** 2.0.0 shipped a button
 * saying scanning was unavailable, which was the bug: not a missing camera, but
 * a screen that refused the job without naming the thing that does it. Android
 * phones already scan QR codes in the camera app and in Lens, and the
 * `lifeos://pair` deep link means doing so opens Life OS directly.
 *
 * Bundling CameraX and an ML Kit model to re-implement that added 24 MB to the
 * APK and a camera permission, to duplicate a capability every one of these
 * phones already has. It was removed. The honest sentence was always the whole
 * fix.
 */
@Composable
private fun ScanningBlock(
    onEnterManually: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    PairBlock(modifier = modifier) {
        Text("Scan the QR with your camera", style = LifeOsType.cardTitle, color = p.text)
        Text(
            text = "Open your phone's camera app and point it at the QR on your " +
                "dashboard — Settings → Pair a phone. Tap the link it offers and " +
                "Life OS opens here, already connected.",
            style = LifeOsType.bodySmall,
            color = p.muted,
        )
        Text(
            text = "Google Lens works too, and so does the pair page on the dashboard.",
            style = LifeOsType.bodySmall,
            color = p.faint,
        )
        Button(
            onClick = onEnterManually,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(
                containerColor = p.accent,
                contentColor = p.bg,
            ),
        ) { Text("Enter the address instead") }
    }
}

/**
 * The claim, in flight.
 *
 * A 2dp line, not a spinner. The app's rule is that nothing the user just
 * touched shows a spinner, and while this *is* a real network wait they asked
 * for, a circular spinner is still a different visual language from the
 * refresh line every other wait in this app uses.
 */
@Composable
private fun ClaimingBlock(address: String, modifier: Modifier = Modifier) {
    val p = palette
    PairBlock(modifier = modifier) {
        Text("Pairing this phone", style = LifeOsType.cardTitle, color = p.text)
        Mono(address, color = p.faint)
        LinearProgressIndicator(
            modifier = Modifier.fillMaxWidth().height(2.dp),
            color = p.accent,
            trackColor = p.surface2,
        )
    }
}

/**
 * A refusal, with the way out that matches it.
 *
 * A burnt or expired code is fixed at the dashboard, so the offer is another
 * scan. An address this phone cannot reach is not a code problem at all, so the
 * offer is **Change server** — sending someone to mint more codes for an
 * unreachable box is how an app wastes an afternoon.
 */
@Composable
private fun FailedBlock(
    message: String,
    changeServer: Boolean,
    onRescan: () -> Unit,
    onEnterManually: () -> Unit,
    onChangeServer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    PairBlock(modifier = modifier) {
        Text(
            text = if (changeServer) "Couldn't reach that address" else "That code didn't work",
            style = LifeOsType.cardTitle,
            color = p.text,
        )
        Text(message, style = LifeOsType.bodySmall, color = p.muted)

        if (changeServer) {
            Button(
                onClick = onChangeServer,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = p.accent,
                    contentColor = p.bg,
                ),
            ) { Text("Change server") }
            TextButton(onClick = onRescan) { Text("Scan again", color = p.muted) }
        } else {
            Button(
                onClick = onRescan,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = p.accent,
                    contentColor = p.bg,
                ),
            ) { Text("Scan again") }
            TextButton(onClick = onEnterManually) {
                Text("Enter the address instead", color = p.muted)
            }
        }
    }
}

/**
 * The one container the three non-camera states share.
 *
 * A card rather than loose text in the middle of a window: these are the only
 * three things on screen, and a sentence floating on the background reads as a
 * screen that failed to finish drawing.
 */
@Composable
private fun PairBlock(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg, Alignment.CenterVertically),
    ) {
        PageBody {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .craftedSurface(RoundedCornerShape(Radii.card))
                    .padding(Spacing.xl),
                verticalArrangement = Arrangement.spacedBy(Spacing.md),
            ) { content() }
        }
    }
}
