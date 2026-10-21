package com.lifeos.app

import com.lifeos.app.data.PairClaim
import com.lifeos.app.data.PairOutcome
import com.lifeos.app.data.api.PairClaimResponse
import com.lifeos.app.domain.PairInvite
import com.lifeos.app.domain.PairLink
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ConnectException

/**
 * QR pairing: the link, and the claim.
 *
 * This is the path a phone takes from "nothing" to "connected", and in 2.0.0 it
 * was dead in two places at once — the manifest matched `lifeos://connect` while
 * the server minted `lifeos://pair`, and once that was fixed the Activity still
 * never read `intent.data`. Both failures were invisible to the test suite
 * because neither the parse nor the claim had one. They do now.
 */
class PairingTest {

    private val lanInvite = "lifeos://pair?code=ABCDEFGH2345&url=" +
        "http%3A%2F%2F192.168.1.4%3A8787"

    /* ------------------------------------------------------------ the link */

    @Test
    fun `the link the server actually mints parses`() {
        // Exactly the shape of `mintPairingCode`'s `deepLink`
        // (apps/api/src/services/pairing.ts).
        val invite = PairLink.parse(lanInvite)
        assertEquals(PairInvite("ABCDEFGH2345", "http://192.168.1.4:8787"), invite)
    }

    @Test
    fun `the connect host is still accepted`() {
        // A QR already on someone's screen outlives the release that drew it,
        // and older servers minted `connect`.
        val invite = PairLink.parse("lifeos://connect?code=ABCDEFGH2345&url=http://nas.local:8787")
        assertEquals("ABCDEFGH2345", invite?.code)
    }

    @Test
    fun `a tunnelled url keeps its scheme and its path prefix`() {
        // The real deployment this has to work for: the API serves the dashboard
        // under a gateway prefix, so dropping the path points the phone at a
        // different instance — or at port 8787 of a box that answers on 443.
        val invite = PairLink.parse(
            "lifeos://pair?code=ABCDEFGH2345&url=" +
                "https%3A%2F%2Fsunny.tailf9037f.ts.net%2Flifeos",
        )
        assertEquals("https://sunny.tailf9037f.ts.net/lifeos", invite?.baseUrl)
    }

    @Test
    fun `an unencoded url survives too`() {
        // Hand-typed links and some QR writers do not encode it. There is no `&`
        // inside a URL this shape, so splitting the query is still unambiguous.
        val invite = PairLink.parse("lifeos://pair?code=ABCDEFGH2345&url=http://192.168.1.4:8787")
        assertEquals("http://192.168.1.4:8787", invite?.baseUrl)
    }

    @Test
    fun `a bare host in the link gets the LAN defaults`() {
        // Same normaliser as the address field, so the two cannot disagree.
        val invite = PairLink.parse("lifeos://pair?code=ABCDEFGH2345&url=192.168.1.4")
        assertEquals("http://192.168.1.4:8787", invite?.baseUrl)
    }

    @Test
    fun `a lower-case scan is a valid scan`() {
        // The claim endpoint upper-cases before comparing, so this is the
        // server's own rule rather than a kindness.
        val invite = PairLink.parse("lifeos://pair?code=abcdefgh2345&url=192.168.1.4")
        assertEquals("ABCDEFGH2345", invite?.code)
    }

    @Test
    fun `the query order does not matter`() {
        val invite = PairLink.parse("lifeos://pair?url=192.168.1.4&code=ABCDEFGH2345")
        assertEquals(PairInvite("ABCDEFGH2345", "http://192.168.1.4:8787"), invite)
    }

    @Test
    fun `a trailing slash on the host is forgiven`() {
        assertEquals(
            "ABCDEFGH2345",
            PairLink.parse("lifeos://pair/?code=ABCDEFGH2345&url=192.168.1.4")?.code,
        )
    }

    @Test
    fun `anything that is not one of our links is rejected rather than guessed`() {
        // A deep link is attacker-reachable: any app and any web page can fire
        // one of these. Nothing here is inferred.
        assertNull(PairLink.parse(null))
        assertNull(PairLink.parse(""))
        assertNull(PairLink.parse("lifeos://pair"))
        assertNull(PairLink.parse("lifeos://pair?code=ABCDEFGH2345"))
        assertNull(PairLink.parse("lifeos://pair?url=192.168.1.4"))
        // Another scheme, and another host of ours.
        assertNull(PairLink.parse("https://192.168.1.4/pair?code=ABCDEFGH2345&url=192.168.1.4"))
        assertNull(PairLink.parse("lifeos://today?code=ABCDEFGH2345&url=192.168.1.4"))
        // Not a code: too short, and characters the server's alphabet excludes.
        assertNull(PairLink.parse("lifeos://pair?code=AB2&url=192.168.1.4"))
        assertNull(PairLink.parse("lifeos://pair?code=ABCD-EFGH2345&url=192.168.1.4"))
        // An address that does not normalise is not an address.
        assertNull(PairLink.parse("lifeos://pair?code=ABCDEFGH2345&url=http%3A%2F%2F"))
    }

    @Test
    fun `the web fallback's fragment is not mistaken for a parameter`() {
        // `<base>/pair#c=CODE` keeps the code in a fragment so it never reaches
        // a server. If the fragment were parsed as query text, a link with no
        // query would appear to carry a code.
        assertNull(PairLink.parse("lifeos://pair#c=ABCDEFGH2345"))
    }

    @Test
    fun `an invite never prints its code`() {
        // The code is traded for the API token, so for the five minutes it lives
        // it is a credential. Nothing logs it on purpose; this makes an accident
        // — a data class interpolated into a message — harmless too.
        val printed = PairInvite("ABCDEFGH2345", "http://192.168.1.4:8787").toString()
        assertTrue(printed.contains("http://192.168.1.4:8787"))
        assertTrue("the code must not appear in toString", !printed.contains("ABCDEFGH2345"))
    }

    /* ----------------------------------------------------------- the claim */

    private fun claimWith(api: FakeApi) = PairClaim(apiFactory = { api })

    @Test
    fun `a good code comes back with the token and the server's own address`() = runTest {
        val api = FakeApi(
            claimResponse = PairClaimResponse(
                // The server says where the *phone* should talk to it, which is
                // not always the address in the QR.
                baseUrl = "https://sunny.tailf9037f.ts.net/lifeos",
                token = "tok_ABC",
            ),
        )
        val outcome = claimWith(api).claim(PairInvite("ABCDEFGH2345", "http://192.168.1.4:8787"))

        assertEquals(
            PairOutcome.Paired("https://sunny.tailf9037f.ts.net/lifeos", "tok_ABC"),
            outcome,
        )
        // Unauthenticated, at the documented path, carrying the code.
        assertEquals(
            "ABCDEFGH2345" to "http://192.168.1.4:8787/api/v1/pair/claim",
            api.claims.single(),
        )
    }

    @Test
    fun `the QR's address is used when the server does not name one`() = runTest {
        val api = FakeApi(claimResponse = PairClaimResponse(token = "tok_ABC"))
        val outcome = claimWith(api).claim(PairInvite("ABCDEFGH2345", "http://192.168.1.4:8787"))
        assertEquals(PairOutcome.Paired("http://192.168.1.4:8787", "tok_ABC"), outcome)
    }

    @Test
    fun `a spent or expired code is one sentence, because the server sends one answer`() =
        runTest {
            // `claimPairingCode` compares in constant time and deliberately
            // returns the same 401 for expired and already-used, so §7.3 asks
            // for one line covering both rather than a guess at which it was.
            val api = FakeApi(claimStatus = 401)
            val outcome = claimWith(api).claim(PairInvite("ABCDEFGH2345", "http://192.168.1.4:8787"))
            assertEquals(
                PairOutcome.Refused("That code is no longer valid. Mint a new one on your dashboard."),
                outcome,
            )
        }

    @Test
    fun `an address nothing answers at is a reachability failure, not a bad code`() = runTest {
        // The distinction that matters: this one offers Change server. Sending
        // someone back to the dashboard to mint more codes for a sleeping
        // machine is how an app wastes an afternoon.
        val api = FakeApi(throwOnClaim = ConnectException("failed to connect"))
        val outcome = claimWith(api).claim(PairInvite("ABCDEFGH2345", "http://192.168.1.4:8787"))
        assertEquals(
            PairOutcome.Unreachable("http://192.168.1.4:8787", "connection refused"),
            outcome,
        )
    }

    @Test
    fun `an older server that has no pairing route says so`() = runTest {
        val api = FakeApi(claimStatus = 404)
        val outcome = claimWith(api).claim(PairInvite("ABCDEFGH2345", "http://192.168.1.4:8787"))
        assertTrue(outcome is PairOutcome.Refused)
        assertTrue((outcome as PairOutcome.Refused).message.contains("does not offer pairing"))
    }

    @Test
    fun `a 200 with no token is a refusal, not a pairing`() = runTest {
        // A reverse proxy swallowing the body is the likely cause, so it must
        // not be reported as "that code is no longer valid" — and it must
        // certainly not save a blank token over a working one.
        val api = FakeApi(claimResponse = PairClaimResponse(baseUrl = "http://192.168.1.4:8787"))
        val outcome = claimWith(api).claim(PairInvite("ABCDEFGH2345", "http://192.168.1.4:8787"))
        assertTrue(outcome is PairOutcome.Refused)
        assertTrue((outcome as PairOutcome.Refused).message.contains("no token"))
    }

    @Test
    fun `no refusal message ever contains the code`() = runTest {
        for (status in listOf(401, 404, 426, 500)) {
            val api = FakeApi(claimStatus = status)
            val outcome = claimWith(api).claim(PairInvite("ABCDEFGH2345", "http://192.168.1.4:8787"))
            val message = (outcome as PairOutcome.Refused).message
            assertTrue("HTTP $status leaked the code", !message.contains("ABCDEFGH2345"))
        }
    }
}
