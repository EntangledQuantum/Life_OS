package com.lifeos.app.data.api

import okhttp3.Call
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.Protocol
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy

/**
 * Did we get as far as a connection before we gave up?
 *
 * This is the one fact that separates *"that address is wrong"* from *"that
 * server is slow"*, and nothing in an `IOException` carries it: a read timeout
 * against a healthy tunnel and a read timeout against a black hole are both a
 * `SocketTimeoutException` with the message `timeout`. So OkHttp is asked
 * directly — `connectEnd` fires once TCP **and** TLS are up, and
 * `connectionAcquired` fires for a pooled connection that skipped both.
 *
 * It exists because the copy depends on it. A timeout where the TLS handshake
 * completed means the address resolved, the host answered, the certificate
 * checked out and the only thing that went wrong is that we ran out of
 * patience — which is a **Try again**, not a **Change server**. Telling that
 * user their address is wrong is how this release's bug wasted an evening.
 *
 * **Deliberately not a logger.** It records two booleans and no URL, no header
 * and no body; `EventListener` is the one OkHttp hook that sees everything,
 * which is exactly why this subclass overrides three methods and nothing else.
 *
 * One witness per call, or per request in a known sequence with [reset] between
 * them — the flags are "the last connection attempt on this client", not a
 * tally.
 */
class ConnectionWitness : EventListener() {

    /**
     * The host resolved to an address.
     *
     * `internal set` rather than `private set` so a unit test can stand in for
     * the OkHttp events it would otherwise have to fake a whole `Call` and
     * `Connection` to produce. Nothing outside this module can write it.
     */
    @Volatile
    internal var resolved: Boolean = false

    /** TCP and, where applicable, TLS completed. The server is there. */
    @Volatile
    internal var connected: Boolean = false

    /** Before each request, when one witness serves a sequence of them. */
    fun reset() {
        resolved = false
        connected = false
    }

    override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) {
        resolved = true
    }

    override fun connectEnd(
        call: Call,
        inetSocketAddress: InetSocketAddress,
        proxy: Proxy,
        protocol: Protocol?,
    ) {
        resolved = true
        connected = true
    }

    /** A connection taken from the pool: no dns and no connect events at all. */
    override fun connectionAcquired(call: Call, connection: Connection) {
        resolved = true
        connected = true
    }
}
