package com.lifeos.app.ui.outdated

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
import com.lifeos.app.data.api.ProtocolMismatchDto
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette

/**
 * `426 Upgrade Required` (§7.7).
 *
 * A full-screen block rather than a panel, because nothing in the app can work:
 * there is no protocol-1 compatibility layer and there never will be. A client
 * that is too old gets told, clearly, once.
 *
 * Change server is still offered — the user may simply have pointed a phone at
 * the wrong machine.
 */
@Composable
fun OutdatedScreen(
    mismatch: ProtocolMismatchDto,
    clientProtocol: Int,
    onDownload: (String) -> Unit,
    onChangeServer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.xxl),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "This app is too old for your Life OS",
            style = LifeOsType.screenTitle,
            color = p.text,
            textAlign = TextAlign.Center,
        )

        val server = mismatch.serverProtocol.takeIf { it > 0 }
        val client = mismatch.clientProtocol.takeIf { it > 0 } ?: clientProtocol
        Mono(
            text = if (server != null) {
                "Your server speaks protocol $server; this app speaks $client."
            } else {
                "This app speaks protocol $client."
            },
            color = p.muted,
        )

        if (mismatch.hint.isNotBlank()) {
            Text(mismatch.hint, style = LifeOsType.bodySmall, color = p.faint, textAlign = TextAlign.Center)
        }

        if (mismatch.downloadUrl.isNotBlank()) {
            Button(
                onClick = { onDownload(mismatch.downloadUrl) },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = p.accent, contentColor = p.bg),
            ) {
                Text("Download the new app")
            }
        }

        TextButton(onClick = onChangeServer) {
            Text("Change server", color = p.muted)
        }
    }
}
