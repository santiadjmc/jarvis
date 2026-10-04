import os from "os";

export function getLocalAddresses(): { ipv4: string[]; ipv6: string[] } {
    const ipv4: string[] = [];
    const ipv6: string[] = [];
    for (const interfaces of Object.values(os.networkInterfaces())) {
        for (const iface of interfaces || []) {
            if (iface.internal) continue;
            if (iface.family === "IPv4") ipv4.push(iface.address);
            else if (iface.family === "IPv6") ipv6.push(iface.address);
        }
    }
    return { ipv4, ipv6 };
}