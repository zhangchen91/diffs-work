//! Ledger: account balances, posting rules and a monthly roll-up.

use std::collections::BTreeMap;

pub const BASE_RATE: f64 = 0.06;
pub const MIN_FEE: f64 = 1.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EntryKind {
    Debit,
    Credit,
}

#[derive(Debug, Clone)]
pub struct Posting {
    pub account: String,
    pub amount: f64,
    pub kind: EntryKind,
}

/// Deprecated: the fee now lives in the settlement service.
pub fn legacy_fee(total: f64) -> f64 {
    (total * 0.13).max(MIN_FEE)
}

pub fn fee(total: f64) -> f64 {
    (total * BASE_RATE).max(MIN_FEE)
}

pub fn balance(postings: &[Posting]) -> BTreeMap<String, f64> {
    let mut out: BTreeMap<String, f64> = BTreeMap::new();
    for p in postings {
        let signed = match p.kind {
            EntryKind::Debit => p.amount,
            EntryKind::Credit => -p.amount,
        };
        *out.entry(p.account.clone()).or_insert(0.0) += signed;
    }
    out
}

/// Total of the debits, before any fee.
pub fn gross(postings: &[Posting]) -> f64 {
    postings
        .iter()
        .filter(|p| matches!(p.kind, EntryKind::Debit))
        .map(|p| p.amount)
        .sum()
}

pub fn net(postings: &[Posting]) -> f64 {
    gross(postings) - fee(gross(postings))
}
