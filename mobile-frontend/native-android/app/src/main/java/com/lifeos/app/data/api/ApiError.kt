package com.lifeos.app.data.api

/**
 * A request must be able to fail, and the failure must say which kind it was.
 *
 * "Can't connect" conflates four different user actions — the machine is asleep,
 * the LAN IP changed, the token was rotated, the app is too old — and the whole
 * design of the server screen (§7.6) is that those four are reported separately.
 * That is only possible if the failure is typed at the bottom of the stack
 * instead of flattened into a message string.
 */
sealed class ApiError(
    message: String,
    /** The address we tried, so every panel can name it. Never the token. */
    val address: String?,
    cause: Throwable? = null,
) : Exception(message, cause) {

    /** Nothing answered: timeout, DNS, refused, no route. */
    class Unreachable(address: String?, val detail: String, cause: Throwable? = null) :
        ApiError("Can't reach Life OS at ${address ?: "the configured address"}", address, cause)

    /** `401`. Clear the token and go to connect. Never retry in a loop. */
    class Unauthorized(address: String?) :
        ApiError("The server did not accept this token", address)

    /** `426`. Nothing in the app can work; full-screen block (§7.7). */
    class Outdated(address: String?, val mismatch: ProtocolMismatchDto) :
        ApiError(mismatch.error.ifBlank { "This app is too old for your Life OS" }, address)

    /** Any other non-2xx, carrying the server's own message where there is one. */
    class Server(address: String?, val code: Int, val serverMessage: String?) :
        ApiError(serverMessage ?: "The server returned $code", address)

    /** A 2xx whose body did not parse. Rare, and worth distinguishing. */
    class Malformed(address: String?, cause: Throwable?) :
        ApiError("The server's reply could not be read", address, cause)

    /**
     * `409` on a habit complete.
     *
     * Not an error at all — it means it was already done today. Modelled so the
     * queue can resolve the write as success, and so no caller can mistake it
     * for something to toast or retry.
     */
    class AlreadyDone(address: String?) : ApiError("Already done today", address)
}
