pub fn early() -> &'static str { "a" }

pub fn moved(x: i32) -> i32 {
    let doubled = x * 2;
    doubled + 1
}

pub fn late() -> &'static str { "z" }
