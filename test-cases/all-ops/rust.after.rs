pub fn line_total(qty: u32, unit: u32) -> u32 {
    qty * unit
}

pub fn discount_rate() -> u32 {
    7
}

pub fn parse_qty(raw: &str) -> u32 {
    raw.trim().parse().unwrap_or(0)
}

pub fn grand_total(lines: &[u32]) -> u32 {
    lines.iter().sum()
}
