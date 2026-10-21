import assert from "node:assert/strict";
import { test } from "node:test";
import { __rankForTest, lanAddresses } from "../src/net.js";

test("lanAddresses returns only private IPv4 addresses", () => {
  for (const a of lanAddresses()) {
    assert.match(a, /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/);
  }
});

test("a real adapter outranks a hypervisor's virtual switch", () => {
  /*
   * The bug this pins down: on Windows with Hyper-V or WSL installed,
   * `os.networkInterfaces()` reports `vEthernet (Default Switch)` at
   * 172.23.x.x before the real `Ethernet` at 192.168.x.x. Callers take [0],
   * so the pairing QR encoded an address that only exists inside the host and
   * the phone could never reach it.
   */
  const real = __rankForTest("Ethernet", "192.168.29.131");
  const hyperv = __rankForTest("vEthernet (Default Switch)", "172.23.128.1");
  const wsl = __rankForTest("vEthernet (WSL (Hyper-V firewall))", "172.27.112.1");
  assert.ok(real < hyperv, "a real adapter must sort before a virtual switch");
  assert.ok(real < wsl, "a real adapter must sort before WSL's switch");

  // A real adapter on 172.16–31 still beats a virtual one on 192.168.
  assert.ok(
    __rankForTest("Ethernet", "172.20.0.5") <
      __rankForTest("vEthernet (Default Switch)", "192.168.1.1"),
    "the adapter's nature outweighs the address range",
  );

  // Ordinary names must not be mistaken for virtual ones.
  assert.equal(__rankForTest("Wi-Fi", "192.168.1.5"), 0);
  assert.equal(__rankForTest("Ethernet 2", "192.168.1.6"), 0);
});
