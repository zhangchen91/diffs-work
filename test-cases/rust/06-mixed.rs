/// A small ledger.
pub const RATE: f64 = 0.05;

pub fn fee(a: f64) -> f64 {
    a * RATE
}

pub fn legacy() -> f64 {
    0.0
}

pub fn sum(xs: &[f64]) -> f64 {
    xs.iter().copied().sum()
}
