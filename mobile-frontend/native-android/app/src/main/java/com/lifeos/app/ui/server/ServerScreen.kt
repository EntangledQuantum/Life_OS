package com.lifeos.app.ui.server

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.lifeos.app.data.ProbeResult
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.components.PageBody
import com.lifeos.app.ui.components.SectionHeader
import com.lifeos.app.ui.theme.LifeOsFonts
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette

/**
 * "Change server" — the broken flow, built (§7.6).
 *
 * In the old app this button existed and did nothing, which is the single most
 * visible bug this rewrite is fixing. So this is a **real top-level destination
 * that works with no token and no connection**, reachable from all five entry
 * points: Settings → Connection, every error panel's *Change server*, the status
 * strip's `⋮`, the connect screen's *Enter the address manually*, and the
 * Unreachable notification.
 *
 * Non-destructive: nothing changes until Save.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ServerScreen(
    state: ServerUiState,
    onAddressChange: (String) -> Unit,
    onTokenChange: (String) -> Unit,
    onKeepTokenChange: (Boolean) -> Unit,
    onToggleTokenVisible: () -> Unit,
    onTest: () -> Unit,
    onSave: () -> Unit,
    onScanQr: () -> Unit,
    onOpenNetworkDocs: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
    ) {
        PageBody {
            SectionHeader("Address")
            OutlinedTextField(
                value = state.address,
                onValueChange = onAddressChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                textStyle = LifeOsType.mono14.copy(fontFamily = LifeOsFonts.mono),
                placeholder = { Mono("http://192.168.1.4:8787", color = p.faint) },
                keyboardOptions = KeyboardOptions(
                    // A URI keyboard, because the realistic input is an IP and a
                    // port and the alphabetic layout fights it.
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Next,
                ),
            )
            Text(
                text = "The scheme and port are filled in for you: typing 192.168.1.4 means " +
                    "http://192.168.1.4:8787.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )

            if (state.recent.isNotEmpty()) {
                // Addresses only, never paired with tokens. The realistic
                // failure is a LAN IP that changed, which is why these are
                // remembered at all.
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Text("Recent:", style = LifeOsType.label, color = p.faint)
                    state.recent.forEach { address ->
                        Mono(
                            text = address.removePrefix("http://").removePrefix("https://"),
                            color = p.accent,
                            modifier = Modifier.clickable { onAddressChange(address) },
                        )
                    }
                }
            }

            SectionHeader("API token")
            OutlinedTextField(
                value = state.token,
                onValueChange = onTokenChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                enabled = !state.keepExistingToken,
                textStyle = LifeOsType.mono14,
                visualTransformation = if (state.tokenVisible) {
                    VisualTransformation.None
                } else {
                    PasswordVisualTransformation()
                },
                trailingIcon = {
                    TextButton(onClick = onToggleTokenVisible) {
                        Text(
                            text = if (state.tokenVisible) "hide" else "show",
                            style = LifeOsType.label,
                            color = p.muted,
                        )
                    }
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            )
            Text(
                // Named so the user knows where to find it, and where it goes.
                text = "From API_TOKEN in your Life OS .env. Stored in the Android Keystore.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )

            if (state.hasStoredToken) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = state.keepExistingToken,
                        onCheckedChange = onKeepTokenChange,
                    )
                    Text("Keep current token", style = LifeOsType.body, color = p.text)
                }
            }

            FilledTonalButton(
                onClick = onTest,
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.testing && state.address.isNotBlank(),
            ) {
                Text(if (state.testing) "Testing…" else "Test")
            }

            /*
             * Four results, reported separately. This is the whole point of the
             * screen: "can't connect" conflates four different user actions —
             * wake the machine, fix the address, paste a new token, update the
             * app — and one combined verdict cannot tell the user which.
             */
            if (state.report != null) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(Radii.card))
                        .background(p.surface)
                        .padding(Spacing.md),
                    verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    ResultRow("Reachable", state.report.reachable)
                    ResultRow("Protocol", state.report.protocol)
                    ResultRow("Token", state.report.auth)
                    ResultRow(
                        label = "LAN",
                        result = state.report.lan,
                        // `lan: false` is a warning, not a failure, and it links
                        // to the docs rather than pretending the app can fix a
                        // server binding to loopback.
                        trailing = if (state.report.lan is ProbeResult.Warn) {
                            { TextButton(onClick = onOpenNetworkDocs) { Text("Read why ›", style = LifeOsType.label, color = p.accent) } }
                        } else {
                            null
                        },
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                FilledTonalButton(onClick = onScanQr, modifier = Modifier.weight(1f)) {
                    Text("Scan QR")
                }
                Button(
                    onClick = onSave,
                    modifier = Modifier.weight(1f),
                    // Save is enabled once Test passed. A failed Test still
                    // offers it, labelled honestly: the machine may simply be
                    // asleep, and saving a known-good address for later is a
                    // legitimate thing to want.
                    enabled = state.address.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = p.accent, contentColor = p.bg),
                ) {
                    Text(if (state.report?.passed == true || state.report == null) "Save" else "Save anyway")
                }
            }

            Text(
                text = "Saving a different address clears the cached day and starts a new " +
                    "life-day epoch — a different server is a different life.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )
        }
    }
}

@Composable
private fun ResultRow(
    label: String,
    result: ProbeResult,
    trailing: (@Composable () -> Unit)? = null,
) {
    val p = palette
    val (mark, colour, detail) = when (result) {
        is ProbeResult.Pending -> Triple("·", p.faint, "not tested")
        is ProbeResult.Pass -> Triple("✓", p.positive, result.detail)
        is ProbeResult.Warn -> Triple("⚠", p.warning, result.detail)
        is ProbeResult.Fail -> Triple("✗", p.neutralNeg, result.detail)
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Text(mark, style = LifeOsType.cardTitle, color = colour)
        Text(label, style = LifeOsType.body, color = p.text, modifier = Modifier.padding(end = Spacing.sm))
        Box(Modifier.weight(1f))
        Mono(detail, color = p.muted)
        trailing?.invoke()
    }
}

/** Reserved for the dp import used by the result rows' spacing. */
private val hairline = 1.dp
