import type { FastifyRequest } from "fastify";

export interface GeoLocationInfo {
    ip: string;
    location: string;
    isp: string;
    city?: string;
    country?: string;
}

const geoCache = new Map<string, { info: GeoLocationInfo; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const COUNTRY_NAME_MAP: Record<string, string> = {
    "vn": "Việt Nam",
    "vietnam": "Việt Nam",
    "viet nam": "Việt Nam",
    "us": "Hoa Kỳ",
    "usa": "Hoa Kỳ",
    "united states": "Hoa Kỳ",
    "united states of america": "Hoa Kỳ",
    "jp": "Nhật Bản",
    "japan": "Nhật Bản",
    "kr": "Hàn Quốc",
    "korea": "Hàn Quốc",
    "south korea": "Hàn Quốc",
    "cn": "Trung Quốc",
    "china": "Trung Quốc",
    "sg": "Singapore",
    "singapore": "Singapore",
    "th": "Thái Lan",
    "thailand": "Thái Lan",
    "my": "Malaysia",
    "malaysia": "Malaysia",
    "id": "Indonesia",
    "indonesia": "Indonesia",
    "ph": "Philippines",
    "philippines": "Philippines",
    "gb": "Vương quốc Anh",
    "uk": "Vương quốc Anh",
    "united kingdom": "Vương quốc Anh",
    "fr": "Pháp",
    "france": "Pháp",
    "de": "Đức",
    "germany": "Đức",
    "au": "Úc",
    "australia": "Úc",
    "ca": "Canada",
    "canada": "Canada",
    "ru": "Nga",
    "russia": "Nga",
    "tw": "Đài Loan",
    "taiwan": "Đài Loan",
    "hk": "Hồng Kông",
    "hong kong": "Hồng Kông",
    "in": "Ấn Độ",
    "india": "Ấn Độ",
    "la": "Lào",
    "laos": "Lào",
    "kh": "Campuchia",
    "cambodia": "Campuchia",
    "mm": "Myanmar",
    "nl": "Hà Lan",
    "netherlands": "Hà Lan",
    "se": "Thụy Điển",
    "sweden": "Thụy Điển",
    "ch": "Thụy Sĩ",
    "switzerland": "Thụy Sĩ",
    "no": "Na Uy",
    "norway": "Na Uy",
    "fi": "Phần Lan",
    "finland": "Phần Lan",
    "dk": "Đan Mạch",
    "denmark": "Đan Mạch",
    "es": "Tây Ban Nha",
    "spain": "Tây Ban Nha",
    "it": "Ý",
    "italy": "Ý",
    "br": "Brazil",
    "brazil": "Brazil",
    "za": "Nam Phi",
    "south africa": "Nam Phi",
    "nz": "New Zealand",
    "new zealand": "New Zealand",
};

const CITY_NAME_MAP: Record<string, string> = {
    // Vietnamese cities & provinces
    "hanoi": "Hà Nội",
    "ha noi": "Hà Nội",
    "ha-noi": "Hà Nội",
    "ho chi minh city": "TP. Hồ Chí Minh",
    "ho chi minh": "TP. Hồ Chí Minh",
    "ho-chi-minh": "TP. Hồ Chí Minh",
    "saigon": "TP. Hồ Chí Minh",
    "sai gon": "TP. Hồ Chí Minh",
    "tphcm": "TP. Hồ Chí Minh",
    "tp hcm": "TP. Hồ Chí Minh",
    "da nang": "Đà Nẵng",
    "danang": "Đà Nẵng",
    "da-nang": "Đà Nẵng",
    "hai phong": "Hải Phòng",
    "haiphong": "Hải Phòng",
    "can tho": "Cần Thơ",
    "cantho": "Cần Thơ",
    "hue": "Huế",
    "thua thien hue": "Huế",
    "nha trang": "Nha Trang",
    "nhatrang": "Nha Trang",
    "vung tau": "Vũng Tàu",
    "vungtau": "Vũng Tàu",
    "bien hoa": "Biên Hòa",
    "bienhoa": "Biên Hòa",
    "buon ma thuot": "Buôn Ma Thuột",
    "buonmathuot": "Buôn Ma Thuột",
    "quy nhon": "Quy Nhơn",
    "quynhon": "Quy Nhơn",
    "long xuyen": "Long Xuyên",
    "thai nguyen": "Thái Nguyên",
    "nam dinh": "Nam Định",
    "bac ninh": "Bắc Ninh",
    "bac giang": "Bắc Giang",
    "quang ninh": "Quảng Ninh",
    "ha long": "Hạ Long",
    "halong": "Hạ Long",
    "thanh hoa": "Thanh Hóa",
    "nghe an": "Nghệ An",
    "vinh": "Vinh",
    "binh duong": "Bình Dương",
    "thu dau mot": "Thủ Dầu Một",
    "dong nai": "Đồng Nai",
    "lao cai": "Lào Cai",
    "sa pa": "Sa Pa",
    "sapa": "Sa Pa",
    "da lat": "Đà Lạt",
    "dalat": "Đà Lạt",
    "phan thiet": "Phan Thiết",
    "phanthiet": "Phan Thiết",
    "tay ninh": "Tây Ninh",
    "tayninh": "Tây Ninh",
    "tien giang": "Tiền Giang",
    "my tho": "Mỹ Tho",
    "mytho": "Mỹ Tho",
    "ben tre": "Bến Tre",
    "bentre": "Bến Tre",
    "an giang": "An Giang",
    "kien giang": "Kiên Giang",
    "rach gia": "Rạch Giá",
    "phu quoc": "Phú Quốc",
    "phuquoc": "Phú Quốc",
    "ca mau": "Cà Mau",
    "camau": "Cà Mau",
    "dong thap": "Đồng Tháp",
    "cao lanh": "Cao Lãnh",
    "soc trang": "Sóc Trăng",
    "tra vinh": "Trà Vinh",
    "vinh long": "Vĩnh Long",
    "hau giang": "Hậu Giang",
    "vi thanh": "Vị Thanh",
    "quang nam": "Quảng Nam",
    "hoi an": "Hội An",
    "tam ky": "Tam Kỳ",
    "quang ngai": "Quảng Ngãi",
    "binh dinh": "Bình Định",
    "phu yen": "Phú Yên",
    "tuy hoa": "Tuy Hòa",
    "khanh hoa": "Khánh Hòa",
    "cam ranh": "Cam Ranh",
    "ninh thuan": "Ninh Thuận",
    "phan rang": "Phan Rang",
    "binh thuan": "Bình Thuận",
    "kon tum": "Kon Tum",
    "gia lai": "Gia Lai",
    "pleiku": "Pleiku",
    "dak lak": "Đắk Lắk",
    "dak nong": "Đắk Nông",
    "gia nghia": "Gia Nghĩa",
    "lam dong": "Lâm Đồng",
    "bao loc": "Bảo Lộc",
    "binh phuoc": "Bình Phước",
    "dong xoai": "Đồng Xoài",
    "ba ria": "Bà Rịa",
    "ha giang": "Hà Giang",
    "cao bang": "Cao Bằng",
    "bac kan": "Bắc Kạn",
    "tuyen quang": "Tuyên Quang",
    "yen bai": "Yên Bái",
    "dien bien": "Điện Biên",
    "dien bien phu": "Điện Biên Phủ",
    "lai chau": "Lai Châu",
    "son la": "Sơn La",
    "hoa binh": "Hòa Bình",
    "phu tho": "Phú Thọ",
    "viet tri": "Việt Trì",
    "vinh phuc": "Vĩnh Phúc",
    "vinh yen": "Vĩnh Yên",
    "hai duong": "Hải Dương",
    "hung yen": "Hưng Yên",
    "ha nam": "Hà Nam",
    "phu ly": "Phủ Lý",
    "ninh binh": "Ninh Bình",
    "quang binh": "Quảng Bình",
    "dong hoi": "Đồng Hới",
    "quang tri": "Quảng Trị",
    "dong ha": "Đông Hà",

    // Major international cities
    "tokyo": "Tokyo",
    "seoul": "Seoul",
    "bangkok": "Bangkok",
    "beijing": "Bắc Kinh",
    "shanghai": "Thượng Hải",
    "guangzhou": "Quảng Châu",
    "shenzhen": "Thâm Quyến",
    "london": "Luân Đôn",
    "paris": "Paris",
    "berlin": "Berlin",
    "moscow": "Mát-xcơ-va",
    "washington": "Washington, D.C.",
    "new york": "New York",
    "los angeles": "Los Angeles",
    "san francisco": "San Francisco",
    "chicago": "Chicago",
    "seattle": "Seattle",
    "singapore": "Singapore",
    "sydney": "Sydney",
    "melbourne": "Melbourne",
    "toronto": "Toronto",
    "vancouver": "Vancouver",
    "taipei": "Đài Bắc",
    "hong kong": "Hồng Kông",
    "kuala lumpur": "Kuala Lumpur",
    "jakarta": "Jakarta",
    "manila": "Manila",
};

let viDisplayNames: Intl.DisplayNames | null = null;
try {
    viDisplayNames = new Intl.DisplayNames(["vi"], { type: "region" });
} catch {
    viDisplayNames = null;
}

export function formatCountryName(raw?: string): string {
    if (!raw) return "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "XX" || trimmed === "T1") return "";
    const lower = trimmed.toLowerCase();
    if (COUNTRY_NAME_MAP[lower]) return COUNTRY_NAME_MAP[lower];

    if (trimmed.length === 2 && viDisplayNames) {
        try {
            const localized = viDisplayNames.of(trimmed.toUpperCase());
            if (localized && localized !== trimmed.toUpperCase()) return localized;
        } catch {
            // Silently ignore
        }
    }
    return trimmed;
}

export function formatCityName(raw?: string, countryRaw?: string): string {
    if (!raw) return "";
    const trimmed = raw.trim();
    if (!trimmed) return "";
    const lower = trimmed.toLowerCase();
    if (CITY_NAME_MAP[lower]) return CITY_NAME_MAP[lower];
    return trimmed;
}

export function formatLocationString(cityRaw?: string, countryRaw?: string): string {
    const country = formatCountryName(countryRaw);
    const city = formatCityName(cityRaw, countryRaw);

    if (city && country) {
        if (city.toLowerCase() === country.toLowerCase()) return country;
        return `${city}, ${country}`;
    }
    return city || country || "Không xác định";
}

export function formatIspName(rawIsp?: string): string {
    if (!rawIsp) return "Không xác định";
    const clean = rawIsp.trim();
    if (!clean || clean === "Không xác định" || clean === "—" || clean === "N/A") return "Không xác định";
    if (clean.includes("Loopback") || clean.includes("Private") || clean.includes("LAN")) {
        return "Loopback / Private LAN";
    }

    const lower = clean.toLowerCase();

    if (lower.includes("viettel")) {
        return "Viettel";
    }
    if (lower.includes("vnpt") || lower.includes("vietnam posts and telecommunications") || lower.includes("vietnam post and telecom")) {
        return "VNPT";
    }
    if (lower.includes("fpt")) {
        return "FPT Telecom";
    }
    if (lower.includes("mobifone") || lower.includes("mobi phone")) {
        return "MobiFone";
    }
    if (lower.includes("cmc telecom") || lower.includes("cmc corp") || lower === "cmc") {
        return "CMC Telecom";
    }
    if (lower.includes("vietnamobile") || lower.includes("vietnam mobile")) {
        return "Vietnamobile";
    }
    if (lower.includes("sctv")) {
        return "SCTV";
    }
    if (lower.includes("vtvcab")) {
        return "VTVCab";
    }
    if (lower.includes("spt")) {
        return "SPT Telecom";
    }
    if (lower.includes("cloudflare")) {
        return "Cloudflare";
    }
    if (lower.includes("google")) {
        return "Google";
    }
    if (lower.includes("microsoft")) {
        return "Microsoft";
    }
    if (lower.includes("amazon") || lower === "aws") {
        return "Amazon (AWS)";
    }

    return clean;
}

export function normalizeLocationString(locStr?: string): string {
    if (!locStr) return "Không xác định";
    const trimmed = locStr.trim();
    if (!trimmed || trimmed === "Không xác định" || trimmed === "N/A" || trimmed === "—") {
        return "Không xác định";
    }
    if (trimmed.includes("Local") || trimmed.includes("cục bộ") || trimmed.includes("LAN")) {
        return "Mạng cục bộ (Local / LAN)";
    }

    if (trimmed.includes(",")) {
        const parts = trimmed.split(",").map((p) => p.trim());
        if (parts.length === 2) {
            return formatLocationString(parts[0], parts[1]);
        }
        if (parts.length > 2) {
            const country = parts[parts.length - 1];
            const city = parts[0];
            return formatLocationString(city, country);
        }
    }

    return formatCountryName(trimmed);
}

export function isLocalOrPrivateIp(ip: string): boolean {
    if (!ip) return true;
    const cleanIp = ip.trim().replace(/^::ffff:/, "");
    if (cleanIp === "127.0.0.1" || cleanIp === "::1" || cleanIp === "localhost") return true;
    if (cleanIp.startsWith("10.") || cleanIp.startsWith("192.168.")) return true;
    if (cleanIp.startsWith("172.")) {
        const parts = cleanIp.split(".");
        const second = parseInt(parts[1], 10);
        if (second >= 16 && second <= 31) return true;
    }
    if (cleanIp.startsWith("fc00:") || cleanIp.startsWith("fe80:")) return true;
    return false;
}

let cachedHostWan: { info: GeoLocationInfo; expiresAt: number } | null = null;

export async function resolveHostWanGeo(): Promise<GeoLocationInfo | null> {
    if (cachedHostWan && cachedHostWan.expiresAt > Date.now()) {
        return cachedHostWan.info;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch("http://ip-api.com/json/?fields=status,country,regionName,city,isp,org,query", {
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (res.ok) {
            const data = (await res.json()) as any;
            if (data.status === "success") {
                const country = formatCountryName(data.country || "Việt Nam");
                const city = formatCityName(data.city, country);
                const loc = formatLocationString(city, country);
                const ispName = formatIspName(data.isp || data.org || "Nhà mạng nội địa");
                const info: GeoLocationInfo = {
                    ip: data.query || "127.0.0.1",
                    location: loc,
                    isp: ispName,
                    city,
                    country,
                };
                cachedHostWan = { info, expiresAt: Date.now() + 60 * 60 * 1000 };
                return info;
            }
        }
    } catch {
        // Fallback secondary service
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const res = await fetch("https://ipwho.is/", { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = (await res.json()) as any;
                if (data.success) {
                    const country = formatCountryName(data.country || "Việt Nam");
                    const city = formatCityName(data.city, country);
                    const loc = formatLocationString(city, country);
                    const ispName = formatIspName(data.connection?.isp || data.connection?.org || "Nhà mạng nội địa");
                    const info: GeoLocationInfo = {
                        ip: data.ip || "127.0.0.1",
                        location: loc,
                        isp: ispName,
                        city,
                        country,
                    };
                    cachedHostWan = { info, expiresAt: Date.now() + 60 * 60 * 1000 };
                    return info;
                }
            }
        } catch {
            // Silently ignore
        }
    }
    return null;
}

export async function resolveIpGeo(ip: string, request?: FastifyRequest): Promise<GeoLocationInfo> {
    const rawIp = (ip || "127.0.0.1").trim().replace(/^::ffff:/, "");

    // 1. Check Cloudflare / Proxy headers if request is passed
    if (request) {
        const cfCountry = (request.headers["cf-ipcountry"] as string)?.trim();
        const cfCity = (request.headers["cf-ipcity"] as string)?.trim();
        const cfRegion = (request.headers["cf-region"] as string)?.trim();
        const cfOrg = (request.headers["cf-as-organization"] as string)?.trim();

        if (cfCountry && cfCountry !== "XX" && cfCountry !== "T1") {
            const country = formatCountryName(cfCountry);
            let city = formatCityName(cfCity || cfRegion, cfCountry);
            let isp = formatIspName(cfOrg || "Cloudflare");

            // If Cloudflare Free proxy omits city and ISP, enrich via fast remote lookup on public IP
            if (!city && (!cfOrg || cfOrg.toLowerCase().includes("cloudflare")) && !isLocalOrPrivateIp(rawIp)) {
                try {
                    const cached = geoCache.get(rawIp);
                    if (cached && cached.expiresAt > Date.now()) {
                        if (cached.info.city) city = cached.info.city;
                        if (cached.info.isp && cached.info.isp !== "Cloudflare CDN") isp = cached.info.isp;
                    } else {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 1200);
                        const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(rawIp)}?fields=status,country,city,isp,org`, {
                            signal: controller.signal,
                        });
                        clearTimeout(timeoutId);
                        if (res.ok) {
                            const data = (await res.json()) as any;
                            if (data.status === "success") {
                                if (data.city) city = formatCityName(data.city, country);
                                if (data.isp || data.org) isp = formatIspName(data.isp || data.org);
                            }
                        }
                    }
                } catch {
                    // Silently continue with country and Cloudflare CDN
                }
            }

            const loc = formatLocationString(city, country);
            return {
                ip: rawIp,
                location: loc,
                isp,
                city,
                country,
            };
        }
    }

    // 2. Local / Private Network check with Smart WAN Auto-Detection
    if (isLocalOrPrivateIp(rawIp)) {
        const hostWan = await resolveHostWanGeo();
        if (hostWan) {
            return {
                ip: rawIp,
                location: hostWan.location,
                isp: hostWan.isp,
                city: hostWan.city,
                country: hostWan.country,
            };
        }
        return {
            ip: rawIp,
            location: "Mạng cục bộ (Local / LAN)",
            isp: "Loopback / Private LAN",
        };
    }

    // 3. Cache lookup
    const cached = geoCache.get(rawIp);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.info;
    }

    // 4. Remote lookup with fast timeout (ip-api.com)
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1800);

        const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(rawIp)}?fields=status,country,regionName,city,isp,org`, {
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = (await res.json()) as any;
            if (data.status === "success") {
                const country = formatCountryName(data.country);
                const city = formatCityName(data.city, country);
                const loc = formatLocationString(city, country);
                const ispName = formatIspName(data.isp || data.org);
                const info: GeoLocationInfo = {
                    ip: rawIp,
                    location: loc,
                    isp: ispName,
                    city,
                    country,
                };
                geoCache.set(rawIp, { info, expiresAt: Date.now() + CACHE_TTL_MS });
                return info;
            }
        }
    } catch {
        // Fallback to secondary service ipwho.is if needed
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1800);
            const res = await fetch(`https://ipwho.is/${encodeURIComponent(rawIp)}`, {
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = (await res.json()) as any;
                if (data.success) {
                    const country = formatCountryName(data.country);
                    const city = formatCityName(data.city, country);
                    const loc = formatLocationString(city, country);
                    const ispName = formatIspName(data.connection?.isp || data.connection?.org);
                    const info: GeoLocationInfo = {
                        ip: rawIp,
                        location: loc,
                        isp: ispName,
                        city,
                        country,
                    };
                    geoCache.set(rawIp, { info, expiresAt: Date.now() + CACHE_TTL_MS });
                    return info;
                }
            }
        } catch {
            // Silently ignore to avoid slowing down user login
        }
    }

    const fallback: GeoLocationInfo = {
        ip: rawIp,
        location: "Không xác định",
        isp: "Không xác định",
    };
    return fallback;
}
