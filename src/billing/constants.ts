/**
 * Official SePay public IP addresses for Webhooks and IPN callbacks.
 * Source: developer.sepay.vn/en/dia-chi-ip
 * Total: 7 IPv4 + 2 IPv6 addresses.
 */
export const SEPAY_OFFICIAL_IPS = [
    // IPv4 (7 addresses)
    '172.236.138.20',
    '172.233.83.68',
    '171.244.35.2',
    '151.158.108.68',
    '151.158.109.79',
    '103.255.238.139',
    '45.57.137.67',

    // IPv6 (2 addresses)
    '2400:8905::2000:8cff:fe98:45cd',
    '2600:3c15::2000:8aff:fedd:874b',
] as const;
