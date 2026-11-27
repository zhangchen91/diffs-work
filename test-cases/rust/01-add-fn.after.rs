pub fn total(items: &[i64]) -> i64 {
    items.iter().sum()
}

pub fn average(items: &[i64]) -> i64 {
    if items.is_empty() {
        return 0;
    }
    total(items) / items.len() as i64
}
