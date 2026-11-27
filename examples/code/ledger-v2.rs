//! Ledger: account balances, posting rules and a monthly roll-up.

use std::collections::BTreeMap;

// 改：基础费率调整
pub const BASE_RATE: f64 = 0.08;
pub const MIN_FEE: f64 = 1.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EntryKind {
    Debit,
    Credit,
    // 增：新增分录类型
    Reversal,
}

#[derive(Debug, Clone)]
pub struct Posting {
    pub account: String,
    pub amount: f64,
    pub kind: EntryKind,
    // 增：新增字段
    pub memo: Option<String>,
}

// 删：legacy_fee 整个函数移除

pub fn fee(total: f64) -> f64 {
    (total * BASE_RATE).max(MIN_FEE)
}

pub fn balance(postings: &[Posting]) -> BTreeMap<String, f64> {
    let mut out: BTreeMap<String, f64> = BTreeMap::new();
    for p in postings {
        let signed = match p.kind {
            EntryKind::Debit => p.amount,
            EntryKind::Credit => -p.amount,
            // 改：新分支
            EntryKind::Reversal => -p.amount,
        };
        let acct = p.memo.clone().unwrap_or_else(|| p.account.clone());
        *out.entry(acct).or_insert(0.0) += signed;
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

// 增：冲销合计
pub fn reversals(postings: &[Posting]) -> f64 {
    postings
        .iter()
        .filter(|p| matches!(p.kind, EntryKind::Reversal))
        .map(|p| p.amount)
        .sum()
}

pub fn net(postings: &[Posting]) -> f64 {
    gross(postings) - reversals(postings) - fee(gross(postings))
}
