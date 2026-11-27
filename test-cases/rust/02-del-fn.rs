pub fn legacy_fee(amount: i64) -> i64 {
    amount * 13 / 100
}

pub fn net(amount: i64) -> i64 {
    amount
}
