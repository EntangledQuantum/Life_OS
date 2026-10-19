package com.lifeos.app.ui.connect

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette

/**
 * First run (§7.3).
 *
 * QR pairing is the primary path and the only filled button: the dashboard mints
 * a single-use code, draws `<base>/pair#c=CODE` as a QR, and the phone trades it
 * for `{baseUrl, token}` at `POST /api/v1/pair/claim`.
 *
 * **This milestone ships the screen and a stub for the scanner.** The camera and
 * on-device barcode model are a later milestone, and a half-wired scanner that
 * silently fails is worse than one that says it is not here yet — so the stub
 * says so and sends the user to manual entry, which is a complete path. Manual
 * entry is the same form as `server`, by design: one form, one set of probes.
 */
@Composable
fun ConnectScreen(
    onScanQr: () -> Unit,
    onEnterManually: () -> Unit,
    onWhereDoIFindThis: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(Spacing.xxl),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Life OS", style = LifeOsType.pulse, color = p.accent)

        Text(
            text = "Life OS runs on your own machine.\nConnect this phone to it.",
            style = LifeOsType.body,
            color = p.muted,
            textAlign = TextAlign.Center,
        )

        Button(
            onClick = onScanQr,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = p.accent, contentColor = p.bg),
        ) {
            Text("Scan the QR on your dashboard")
        }

        TextButton(onClick = onEnterManually) {
            Text("Enter the address manually", color = p.text)
        }

        TextButton(onClick = onWhereDoIFindThis) {
            Text("Where do I find this? ›", color = p.muted, style = LifeOsType.bodySmall)
        }
    }
}

/**
 * The scanner's placeholder.
 *
 * Camera permission denied must never be a dead end (§7.3), and neither must a
 * feature that has not shipped: both fall straight through to manual entry with
 * one line of explanation.
 */
@Composable
fun PairStubScreen(onEnterManually: () -> Unit, modifier: Modifier = Modifier) {
    val p = palette
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.xxl),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("QR scanning isn't in this build yet", style = LifeOsType.cardTitle, color = p.text)
        Text(
            text = "Enter the address and token by hand instead — it is the same form, and the " +
                "same four checks.",
            style = LifeOsType.bodySmall,
            color = p.muted,
            textAlign = TextAlign.Center,
        )
        Button(
            onClick = onEnterManually,
            colors = ButtonDefaults.buttonColors(containerColor = p.accent, contentColor = p.bg),
        ) {
            Text("Enter the address")
        }
    }
}
