package com.lifeos.app

import com.lifeos.app.data.ConnectionState
import com.lifeos.app.data.api.AddressInput
import com.lifeos.app.data.api.ApiClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The address field, and the connection state machine's thresholds.
 *
 * The realistic failure this product has is a LAN IP that changed, typed in a
 * hurry, with no scheme and often no port. The field has to be forgiving without
 * guessing anything the user did not mean.
 */
class AddressInputTest {

    @Test
    fun `a bare IP gets http and the default port`() {
        assertEquals("http://192.168.1.4:8787", AddressInput.normalise("192.168.1.4"))
    }

    @Test
    fun `an explicit port is kept`() {
        assertEquals("http://192.168.1.4:3000", AddressInput.normalise("192.168.1.4:3000"))
        assertEquals("http://192.168.1.4:8787", AddressInput.normalise("192.168.1.4:8787"))
    }

    @Test
    fun `https is never downgraded`() {
        assertEquals("https://life.example.com:443", AddressInput.normalise("https://life.example.com:443"))
        // No port on an https host still gets 8787, because that is where Life OS
        // listens; a user who means 443 types it.
        assertEquals("https://life.example.com:8787", AddressInput.normalise("https://life.example.com"))
    }

    @Test
    fun `a tailscale name works`() {
        assertEquals("http://my-box.tail1234.ts.net:8787", AddressInput.normalise("my-box.tail1234.ts.net"))
    }

    @Test
    fun `whitespace and a trailing slash are forgiven`() {
        assertEquals("http://192.168.1.4:8787", AddressInput.normalise("  192.168.1.4/  "))
    }

    @Test
    fun `nonsense is rejected rather than turned into a request`() {
        assertNull(AddressInput.normalise(""))
        assertNull(AddressInput.normalise("   "))
        assertNull(AddressInput.normalise("http://"))
    }

    @Test
    fun `retrofit's trailing slash is added exactly once`() {
        assertEquals("http://a:8787/", ApiClient.normaliseBase("http://a:8787"))
        assertEquals("http://a:8787/", ApiClient.normaliseBase("http://a:8787/"))
    }

    @Test
    fun `the protocol this build speaks is 3`() {
        // Copied from packages/shared/src/protocol.ts (PROTOCOL_VERSION = 3).
        // docs/API.md still documents 2; protocol.ts is the source of truth.
        assertEquals(3, ApiClient.clientProtocol)
        assertEquals("x-lifeos-protocol", ApiClient.PROTOCOL_HEADER)
    }

    @Test
    fun `stale becomes unreachable at the third failure`() {
        val now = 1_000_000L
        val fresh = now - 1_000L

        assertTrue(ConnectionState.afterFailure(1, fresh, now, null) is ConnectionState.Stale)
        assertTrue(ConnectionState.afterFailure(2, fresh, now, null) is ConnectionState.Stale)
        assertTrue(ConnectionState.afterFailure(3, fresh, now, null) is ConnectionState.Unreachable)
    }

    @Test
    fun `a cache older than ten minutes is unreachable however few failures`() {
        val now = 1_000_000L
        val old = now - (11 * 60 * 1000L)
        assertTrue(ConnectionState.afterFailure(1, old, now, null) is ConnectionState.Unreachable)
    }

    @Test
    fun `no cache at all is unreachable, not stale`() {
        // "Stale" means there is something honest to show. With nothing cached
        // there is not.
        assertTrue(ConnectionState.afterFailure(1, null, 1_000L, null) is ConnectionState.Unreachable)
    }

    @Test
    fun `only stale and unreachable draw the strip`() {
        assertTrue(ConnectionState.Stale(1, 0L).showsStrip)
        assertTrue(ConnectionState.Unreachable(3, 0L, null).showsStrip)
        // Online shows nothing at all — success is silent.
        assertTrue(!ConnectionState.Online.showsStrip)
        assertTrue(!ConnectionState.Probing.showsStrip)
        assertTrue(!ConnectionState.Unauthorized.showsStrip)
    }
}
