package com.lifeos.app

import com.lifeos.app.data.PollIntervals
import com.lifeos.app.data.StaticToken
import com.lifeos.app.data.TransportFailure
import com.lifeos.app.data.api.AddressInput
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.Budget
import com.lifeos.app.data.api.ConnectionWitness
import com.lifeos.app.data.api.Reach
import com.lifeos.app.ui.theme.Motion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Which server we are talking to, and how long we are willing to wait for it.
 *
 * This is the 2.0.1 bug written down as arithmetic. The user's Life OS is
 * behind a Tailscale Funnel and a reverse proxy; measured with `curl` **on the
 * phone**, its `POST /api/v1/pair/claim` takes 12.27–17.37s and its
 * `GET /health` takes 3.45–5.69s. The app gave the claim the *probe's* 6s, so
 * pairing could not succeed once — and `/health` straddling 6s is why that
 * server read as flaky rather than as down.
 *
 * Every assertion below is either a parity check against
 * `apps/api/src/net.ts` (`isPrivateHostname`, which this classification is a
 * port of) or a margin check against one of those measurements.
 */
class BudgetTest {

    /* ------------------------------------------------- the classification */

    @Test
    fun `loopback and RFC 1918 hosts are private`() {
        // Parity with isPrivateHostname in apps/api/src/net.ts. If these two
        // disagree, the app and the server disagree about what "my own
        // network" means for the same address.
        for (host in listOf(
            "localhost",
            "dev.localhost",
            "macbook.local",
            "nas.local",
            "127.0.0.1",
            "127.1.2.3",
            "10.0.0.5",
            "192.168.1.4",
            "172.16.0.1",
            "172.31.255.255",
            "169.254.1.1",
            "::1",
            "[::1]",
            "fe80::1",
            "fc00::1",
            "fd12:3456::1",
        )) {
            assertTrue("$host should be private", Reach.isPrivateHost(host))
        }
    }

    @Test
    fun `public hosts and the ranges that only look private are not`() {
        for (host in listOf(
            "sunny.tailf9037f.ts.net",
            "example.com",
            "8.8.8.8",
            // The two edges of 172.16/12. Off by one in either direction here
            // and a LAN address gets a 30s budget or a public one gets 6s.
            "172.15.0.1",
            "172.32.0.1",
            "11.0.0.1",
            "193.168.1.4",
        )) {
            assertFalse("$host should not be private", Reach.isPrivateHost(host))
        }
    }

    @Test
    fun `a tailnet address is not treated as local, deliberately`() {
        // 100.64.0.0/10. `net.ts` says the same, and the reason is that the app
        // cannot tell a direct WireGuard path on the same Wi-Fi from one
        // relayed through a DERP server on another continent. The honest budget
        // for "I cannot tell" is the generous one — and §7.6's own example
        // offers `100.92.3.11:8787` as a recent address.
        assertFalse(Reach.isPrivateHost("100.92.3.11"))
        assertEquals(Budget.REMOTE, Budget.of("http://100.92.3.11:8787"))
    }

    @Test
    fun `the address field's output classifies correctly`() {
        // The two forms that actually reach `Budget.of`: a bare LAN host the
        // field filled in, and a tunnel URL typed with its scheme and path.
        assertEquals(Budget.LOCAL, Budget.of(AddressInput.normalise("192.168.1.4")))
        assertEquals(
            Budget.REMOTE,
            Budget.of(AddressInput.normalise("https://sunny.tailf9037f.ts.net/lifeos")),
        )
    }

    @Test
    fun `an address with a trailing slash or no scheme still classifies`() {
        // `ApiClient.normaliseBase` adds the slash, and a stored value can be
        // schemeless. Neither may flip the verdict.
        assertEquals(Budget.LOCAL, Budget.of("http://192.168.1.4:8787/"))
        assertEquals(Budget.LOCAL, Budget.of("192.168.1.4:8787"))
        assertEquals(Budget.REMOTE, Budget.of("https://sunny.tailf9037f.ts.net/lifeos/"))
    }

    @Test
    fun `an unusable address gets the generous budget`() {
        // Deliberately asymmetric: guessing LOCAL for something unrecognisable
        // risks the exact failure this release fixes — a correct address the
        // app refuses to wait for. Guessing REMOTE only risks waiting.
        assertEquals(Budget.REMOTE, Budget.of(null))
        assertEquals(Budget.REMOTE, Budget.of(""))
        assertEquals(Budget.REMOTE, Budget.of("   "))
        assertEquals(Budget.REMOTE, Budget.of("http://"))
    }

    /* -------------------------------------------------------- the budgets */

    @Test
    fun `a LAN server still fails fast`() {
        // §7 exists to stop a user on Wi-Fi waiting 30s for a sleeping laptop.
        // These are §0.2's numbers, unchanged, and they must stay unchanged.
        val lan = Budget.of("http://192.168.1.4:8787")
        assertEquals(5L, lan.connectSeconds)
        assertEquals(12L, lan.readSeconds)
        assertEquals(15L, lan.callSeconds)
        assertEquals(6L, lan.probeSeconds)
        assertEquals(6L, lan.forProbe().callSeconds)
    }

    @Test
    fun `the funnel server's claim gets more than its measured worst case`() {
        val claim = Budget.of("https://sunny.tailf9037f.ts.net/lifeos").forClaim()
        // Measured on the phone: 12.27s, 13.85s, 17.37s. The brief's floor is
        // ~30s; the margin past it is the point, because that is three samples
        // on one evening of one network.
        assertTrue("claim budget ${claim.callSeconds}s is under 30s", claim.callSeconds >= 30L)
        assertTrue(claim.callSeconds >= 2 * 18L)
        // And no inner deadline may fire first: a read timeout at 30s on a 45s
        // call budget would reinstate the bug with a bigger number.
        assertTrue(claim.readSeconds >= claim.callSeconds)
        assertTrue(claim.writeSeconds >= claim.callSeconds)
    }

    @Test
    fun `the funnel server's probe clears its measured health check`() {
        val probe = Budget.of("https://sunny.tailf9037f.ts.net/lifeos").forProbe()
        // `GET /health` measured at up to 5.69s. 6s was why this server tested
        // as flaky: some runs cleared it and some did not.
        assertTrue("probe ${probe.callSeconds}s has no margin over 5.69s", probe.callSeconds >= 12L)
    }

    @Test
    fun `the funnel server's poll clears its worst measured fetch`() {
        // The ordinary call budget is the poll's, and a poll that times out
        // mid-flight walks the state machine Online to Unreachable (§7.2) on a
        // server that was answering the whole time. The governing number is not
        // the round trip, it is the 2.26 MB dashboard payload: measured from
        // the phone at 3.64, 10.92, 23.17 and 41.55 seconds. 30s was tried on
        // the device and still reported `timeout`.
        val remote = Budget.of("https://sunny.tailf9037f.ts.net/lifeos")
        assertTrue("${remote.callSeconds}s does not clear a 41.55s fetch", remote.callSeconds > 42L)
        // A read deadline under the call cap would quietly become the real
        // limit, which is how a bigger number fixes nothing.
        assertTrue(remote.readSeconds >= remote.callSeconds)
        // The handshake alone measured 1.4–2.5s, so 5s to connect was tight.
        assertTrue(remote.connectSeconds >= 10L)
    }

    @Test
    fun `the probe is always the shortest wait`() {
        // The whole reason a probe has its own number: somebody is watching it.
        for (budget in listOf(Budget.LOCAL, Budget.REMOTE)) {
            assertTrue(budget.probeSeconds <= budget.callSeconds)
            assertTrue(budget.probeSeconds <= budget.claimSeconds)
        }
        // The claim is *not* bound to the ordinary call budget in either
        // direction. Remotely it is deliberately shorter, because the thing
        // that makes the poll slow is a 2.26 MB body and the claim's response
        // is a token — sizing one from the other would be a coincidence, not a
        // reason.
        assertTrue(Budget.REMOTE.claimSeconds >= 30L)
        assertEquals(Budget.LOCAL.callSeconds, Budget.LOCAL.claimSeconds)
    }

    @Test
    fun `forProbe and forClaim change only the deadlines they own`() {
        val base = Budget.REMOTE
        assertEquals(base.connectSeconds, base.forProbe().connectSeconds)
        assertEquals(base.connectSeconds, base.forClaim().connectSeconds)
        assertEquals(base.probeSeconds, base.forProbe().callSeconds)
        assertEquals(base.claimSeconds, base.forClaim().callSeconds)
    }

    /* ----------------------------------------------------------- the poll */

    @Test
    fun `a LAN poll keeps its eight seconds`() {
        assertEquals(
            PollIntervals.TODAY_MS,
            PollIntervals.forAddress("http://192.168.1.4:8787", PollIntervals.TODAY_MS),
        )
        assertEquals(
            PollIntervals.YOU_MS,
            PollIntervals.forAddress("http://nas.local:8787", PollIntervals.YOU_MS),
        )
    }

    @Test
    fun `a tunnelled poll is slower than a typical fetch`() {
        // Measured on the phone: the dashboard payload is 2.26 MB and takes
        // 3.64–41.55s. An 8s tick means a download is permanently in flight.
        // No interval can beat the worst case — that needs a smaller payload,
        // which is the API's problem — but it must clear the median.
        val interval = PollIntervals.forAddress(
            "https://sunny.tailf9037f.ts.net/lifeos",
            PollIntervals.TODAY_MS,
        )
        assertTrue("$interval ms does not clear a typical fetch", interval >= 30_000L)
    }

    @Test
    fun `stretching the poll keeps the destinations in order`() {
        // Today is the liveliest and You the least; that ordering is the
        // product's, and a multiplier must not reshuffle it.
        val remote = "https://sunny.tailf9037f.ts.net/lifeos"
        val today = PollIntervals.forAddress(remote, PollIntervals.TODAY_MS)
        val day = PollIntervals.forAddress(remote, PollIntervals.DAY_MS)
        val you = PollIntervals.forAddress(remote, PollIntervals.YOU_MS)
        assertTrue(today < day)
        assertTrue(day < you)
    }

    @Test
    fun `the empty-cache panel waits out a slow first fetch`() {
        // 6s flat put "Waiting for today's dashboard" and a Change server
        // button in front of a fetch that was still on its way.
        val grace = PollIntervals.emptyCacheTimeout(
            "https://sunny.tailf9037f.ts.net/lifeos",
            Motion.EMPTY_CACHE_ERROR_MS,
        )
        assertTrue("$grace ms still cuts off a typical first fetch", grace >= 24_000L)
        assertEquals(
            Motion.EMPTY_CACHE_ERROR_MS,
            PollIntervals.emptyCacheTimeout("http://192.168.1.4:8787", Motion.EMPTY_CACHE_ERROR_MS),
        )
    }

    /* ------------------------------------------------- connection reuse */

    @Test
    fun `every client shares one connection pool`() {
        // Measured on the phone through the Funnel: a new connection costs
        // 1.09s of which 0.80s is TLS; a reused one costs 0.30s with no
        // handshake at all — 3.6x. An OkHttpClient.Builder gets a *fresh*
        // ConnectionPool unless told otherwise, so the probe, the claim, the
        // poll and the image loader were each paying their own handshake
        // against a server where that is a second and a half.
        val probe = ApiClient.okHttp(StaticToken(""), Budget.REMOTE.forProbe())
        val claim = ApiClient.okHttp(StaticToken(""), Budget.REMOTE.forClaim())
        val ordinary = ApiClient.okHttp(StaticToken(""), Budget.REMOTE)

        assertSame(ApiClient.connections, probe.connectionPool)
        assertSame(ApiClient.connections, claim.connectionPool)
        assertSame(ApiClient.connections, ordinary.connectionPool)
    }

    @Test
    fun `the pool outlives the slowest poll interval`() {
        // A connection dropped between ticks buys back the handshake the pool
        // exists to avoid. The slowest remote interval is You at 15s x4.
        val slowestPollMs = PollIntervals.forAddress(
            "https://sunny.tailf9037f.ts.net/lifeos",
            PollIntervals.YOU_MS,
        )
        assertTrue(slowestPollMs < 5 * 60 * 1000L)
    }

    /* ------------------------------------------------- slow vs unreachable */

    @Test
    fun `a timeout after a connection is slow, not unreachable`() {
        val witness = ConnectionWitness().apply { resolved = true; connected = true }
        val failure = TransportFailure.of(SocketTimeoutException("timeout"), witness, 45)
        assertTrue(failure is TransportFailure.Slow)
        assertEquals(45L, (failure as TransportFailure.Slow).seconds)
        // The sentence has to say both halves: we got there, and we gave up.
        assertTrue(failure.detail.contains("connected"))
        assertTrue(failure.detail.contains("45s"))
    }

    @Test
    fun `a call timeout wrapping its cause is still a timeout`() {
        // OkHttp enforces the call deadline outside the interceptor stack: the
        // call is cancelled and the InterruptedIOException that surfaces
        // carries the original failure as its cause. Reading only the top of
        // the chain misses the case this whole distinction is about.
        val wrapped = InterruptedIOException("timeout").apply {
            initCause(SocketTimeoutException("timeout"))
        }
        val witness = ConnectionWitness().apply { connected = true }
        assertTrue(TransportFailure.of(wrapped, witness, 30) is TransportFailure.Slow)
    }

    @Test
    fun `a timeout with no connection stays unreachable`() {
        // Nothing was reached, so "the address is right, try again" would be a
        // guess — and the wrong one.
        val failure = TransportFailure.of(
            SocketTimeoutException("timeout"),
            ConnectionWitness(),
            45,
        )
        assertEquals(TransportFailure.Unreachable("timed out"), failure)
    }

    @Test
    fun `the named socket failures keep their own sentences`() {
        val connected = ConnectionWitness().apply { connected = true }
        // A refusal or a bad hostname is never "slow", even on a host we had
        // previously connected to: there is nothing to wait for.
        assertEquals(
            TransportFailure.Unreachable("connection refused"),
            TransportFailure.of(ConnectException("failed"), connected, 45),
        )
        assertEquals(
            TransportFailure.Unreachable("no such host"),
            TransportFailure.of(UnknownHostException("nope"), connected, 45),
        )
    }

    @Test
    fun `with no witness every timeout reads as unreachable`() {
        // The conservative fallback, which is what every caller that does not
        // ask for a witness gets.
        assertTrue(
            TransportFailure.of(SocketTimeoutException("timeout"), null, 15)
                is TransportFailure.Unreachable,
        )
    }

    @Test
    fun `a circular cause chain does not hang the failure path`() {
        val a = InterruptedIOException("a")
        val b = IllegalStateException("b")
        // Not actually circular — Throwable forbids it — but deeply nested
        // enough to prove the walk is bounded and still finds the timeout.
        var nested: Throwable = a
        repeat(4) { nested = RuntimeException("wrap", nested) }
        assertTrue(
            TransportFailure.of(nested, ConnectionWitness().apply { connected = true }, 20)
                is TransportFailure.Slow,
        )
        assertTrue(TransportFailure.of(b, null, 20) is TransportFailure.Unreachable)
    }
}
