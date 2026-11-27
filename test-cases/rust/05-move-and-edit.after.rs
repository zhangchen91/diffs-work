pub fn early() -> &'static str { "a" }

pub fn late() -> &'static str { "z" }

pub fn moved(x: i32) -> i32 {
    let doubled = x * 3;
    doubled + 1
}
