/// A small ledger.
pub const RATE: f64 = 0.07;

pub fn sum(xs: &[f64]) -> f64 {
    xs.iter().copied().sum()
}

pub fn fee(a: f64) -> f64 {
    a * RATE
}

pub fn count(xs: &[f64]) -> usize {
    xs.len()
}
