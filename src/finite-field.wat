(module
  (import "./util.js" "logBytesAsBigint#lift" (func $logBytesAsBigint (param i32)))
  (import "js" "console.log" (func $log64 (param i64)))
  (import "js" "console.log" (func $log32 (param i32)))
  (import "js" "console.log" (func $log32.64 (param i32 i64)))
  (import "watever/memory.wat" "alloc" (func $alloc (param i32) (result i32)))
  (import "watever/memory.wat" "keep" (func $keep (param i32)))
	(import "watever/memory.wat" "free" (func $free (param i32)))
  (import "watever/memory.wat" "reset" (func $reset (param i32)))
  (import "watever/glue.wat" "lift_uint64array" (func $lift_bytes (param i32) (result i32)))
  (import "watever/glue.wat" "lift_raw_uint64array" (func $lift_raw_bytes (param i32 i32) (result i32)))

  (export "multiplyWithReturn#lift" (func $multiplyWithReturn))
  (export "multiply" (func $multiply.381.12_leg))
  (export "add" (func $add.381.12_leg))
  (export "addNoReduce" (func $addNoReduce.381.12_leg))
  (export "subtract" (func $subtract.381.12_leg))
  (export "subtractNoReduce" (func $subtractNoReduce.381.12_leg))
  (export "reduceInPlace" (func $reduce.381.12_leg))
  (export "equals" (func $equals.381.12_leg))
  (export "isZero" (func $isZero.381.12_leg))
  (export "isGreater" (func $isGreater.381.12_leg))
  (export "storeField" (func $storeField))
  (export "storeFieldIn" (func $storeFieldIn))
  (export "emptyField" (func $emptyField))
  (export "freeField" (func $freeField))

  ;; note: wasm is LITTLE-ENDIAN (least significant byte first),
  ;; but (as always) every single byte is stored big-endian (most significant bit first)
  ;; so the int64 0x0000000001020304 is stored as "\04\03\02\01\00\00\00\00"
  ;; we also store a number of i64 legs in LITTLE-ENDIAN form (small first)
  (global $p i32 (i32.const 0)) ;; 12 x i64 = 96 bytes
  (data (i32.const 0)
    ;; 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn
    "\ab\aa\ff\ff\00\00\00\00"
    "\ff\ff\fe\b9\00\00\00\00"
    "\ff\ff\53\b1\00\00\00\00"
    "\fe\ff\ab\1e\00\00\00\00"
    "\24\f6\b0\f6\00\00\00\00"
    "\a0\d2\30\67\00\00\00\00"
    "\bf\12\85\f3\00\00\00\00"
    "\84\4b\77\64\00\00\00\00"
    "\d7\ac\4b\43\00\00\00\00"
    "\b6\a7\1b\4b\00\00\00\00"
    "\9a\e6\7f\39\00\00\00\00"
    "\ea\11\01\1a\00\00\00\00"
  )
  (global $p2 i32 (i32.const 96)) ;; 12 x i64 = 96 bytes
  (data (i32.const 96)
    ;; 0x340223d472ffcd3496374f6c869759aec8ee9709e70a257ece61a541ed61ec483d57fffd62a7ffff73fdffffffff5556
    "\56\55\ff\ff\00\00\00\00"
    "\ff\ff\fd\73\00\00\00\00"
    "\ff\ff\a7\62\00\00\00\00"
    "\fd\ff\57\3d\00\00\00\00"
    "\48\ec\61\ed\00\00\00\00"
    "\41\a5\61\ce\00\00\00\00"
    "\7e\25\0a\e7\00\00\00\00"
    "\09\97\ee\c8\00\00\00\00"
    "\ae\59\97\86\00\00\00\00"
    "\6c\4f\37\96\00\00\00\00"
    "\34\cd\ff\72\00\00\00\00"
    "\d4\23\02\34\00\00\00\00"
  )
  (global $rm2p i32 (i32.const 192)) ;; 12 x i64 = 96 bytes
  (data (i32.const 192)
    ;; 0xcbfddc2b8d0032cb69c8b0937968a651371168f618f5da81319e5abe129e13b7c2a800029d5800008c0200000000aaaa
    "\aa\aa\00\00\00\00\00\00"
    "\00\00\02\8c\00\00\00\00"
    "\00\00\58\9d\00\00\00\00"
    "\02\00\a8\c2\00\00\00\00"
    "\b7\13\9e\12\00\00\00\00"
    "\be\5a\9e\31\00\00\00\00"
    "\81\da\f5\18\00\00\00\00"
    "\f6\68\11\37\00\00\00\00"
    "\51\a6\68\79\00\00\00\00"
    "\93\b0\c8\69\00\00\00\00"
    "\cb\32\00\8d\00\00\00\00"
    "\2b\dc\fd\cb\00\00\00\00"
  )

  (global $mu i64 (i64.const 0x00000000fffcfffd)) ;; -p^(-1) mod 2^32

  (func $logField (param $x i32)
    (call $logBytesAsBigint (call $lift_raw_bytes (local.get $x) (i32.const 96)))
  )
  (func $logLeg (param $x i32)
    (call $logBytesAsBigint (call $lift_raw_bytes (local.get $x) (i32.const 8)))
  )
  (func $storeField (param $x i32) (result i32)
    (call $keep (local.get $x))
    (local.get $x)
  )
  (func $storeFieldIn (param $x i32) (param $pointer i32)
    (local $i i32)
    ;;  for (let i = 0; i < 96; i+=8) {
    ;;    pointer[i] = x[i];
    ;;  }
    (local.set $i (i32.const 0))
    (loop
      (i32.add (local.get $pointer) (local.get $i)) ;; pointer[i] = 
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      i64.store ;; pointer[i] = x[i]
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
  )
  (func $emptyField (result i32) (local $x i32)
    (call $alloc_zero (i32.const 96 (; 12 * 8 ;)))
    local.tee $x
    call $keep
    local.get $x
  )
  (func $freeField (param $x i32)
    (call $free (local.get $x))
    (call $reset)
  )

  (func $multiplyWithReturn (param $x i32) (param $y i32) (result i32)
    (local $xy i32)
    ;; let xy = new BigUint64Array(12);
		(call $alloc_zero (i32.const 96 (; 12 * 8 ;)))
		local.set $xy
    (call $multiply.381.12_leg (local.get $xy) (local.get $x) (local.get $y))
    (call $lift_bytes (local.get $xy))
  )

  (func $multiply.381.12_leg (param $xy i32) (param $x i32) (param $y i32)
    ;; x and y are 12 i64 legs which represent 12 base 2^32 digits, s.t. 0 <= x, y < 2p
    ;; xy === x*y/R mod p and 0 <= xy < 2p, where R = 2^384 is the montgomery radix
    ;; all 12xi64s are stored little-endian (small first)
    (local $i i32) (local $j i32) (local $q i32) (local $t i32)
    (local $C i64) (local $A i64) (local $tmp i64) (local $m i64)

    (local.set $q (global.get $p))

    ;; let t = new BigUint64Array(12);
		(call $alloc_zero (i32.const 96 (; 12 * 8 ;)))
		local.set $t

    ;; for (let i = 0; i < 96; i+=8) {
    (local.set $i (i32.const 0))
    (loop 
      ;;  let tmp = t[0] + x[i] * y[0];
      ;;  t[0] = tmp & 0xffffffffn;
      ;;  let A = tmp >> 32n;
      (i64.load (local.get $t)) ;; t[0]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load (local.get $y)) ;; y[i]
      i64.mul ;; x[i] * y[0]
      i64.add ;; t[0] + x[i] * y[0]
      local.set $tmp ;; let tmp = t[0] + x[i] * y[0]
      ;; (call $logLeg (local.get $t))
      local.get $t ;; t[0] =
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      i64.store ;; t[0] = tmp & 0xffffffffn
      (i64.shr_u (local.get $tmp) (i64.const 32)) ;; tmp >> 32n
      local.set $A ;; let A = tmp >> 32n
      
      ;;  let m = (t[0] * mu0) & 0xffffffffn;
      (i64.load (local.get $t)) ;; t[0]
      (global.get $mu) ;; mu0
      i64.mul ;; t[0] * mu0
      i64.const 0xffffffff ;; 0xffffffffn
      i64.and ;; (t[0] * mu0) & 0xffffffffn
      local.set $m ;; let m = (t[0] * mu0) & 0xffffffffn

      ;;  let C = (t[0] + m * q[0]) >> 32n;
      (i64.load (local.get $t)) ;; t[0]
      local.get $m ;; m
      (i64.load (local.get $q)) ;; q[0]
      i64.mul ;; m * q[0]
      i64.add ;; t[0] + m * q[0]
      i64.const 32 ;; 32n
      i64.shr_u ;; (t[0] + m * q[0]) >> 32n
      local.set $C ;; let C = (t[0] + m * q[0]) >> 32n
      
      ;; for (let j = 8; j < 96; j+=8) {
      (local.set $j (i32.const 8))
      (loop
        ;;  let tmp = t[j] + x[i] * y[j] + A;
        (i64.load (i32.add (local.get $t) (local.get $j))) ;; t[j]
        (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
        (i64.load (i32.add (local.get $y) (local.get $j))) ;; y[j]
        i64.mul ;; x[i] * y[j]
        i64.add ;; t[j] + x[i] * y[j]
        local.get $A ;; A
        i64.add ;; t[j] + x[i] * y[j] + A
        local.set $tmp ;; let tmp = t[j] + x[i] * y[j] + A

        ;;  t[j] = tmp & 0xffffffffn;
        (i32.add (local.get $t) (local.get $j)) ;; t[j] =
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
        i64.store ;; t[j] = tmp & 0xffffffffn

        ;;  A = tmp >> 32n;
        local.get $tmp
        i64.const 32 ;; 32n
        i64.shr_u ;; tmp >> 32n
        local.set $A ;; let A = tmp >> 32n

        ;;  tmp = t[j] + m * q[j] + C;
        (i64.load (i32.add (local.get $t) (local.get $j))) ;; t[j]
        local.get $m ;; m
        (i64.load (i32.add (local.get $q) (local.get $j))) ;; q[j]
        i64.mul ;; m * q[j]
        i64.add ;; t[j] + m * q[j]
        local.get $C ;; C
        i64.add ;; t[j] + m * q[j] + C
        local.set $tmp ;; let tmp = t[j] + m * q[j] + C

        ;;  t[j - 1] = tmp & 0xffffffffn;
        (i32.sub (i32.add (local.get $t) (local.get $j)) (i32.const 8)) ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
        i64.store ;; t[j - 1] = tmp & 0xffffffffn

        ;;  C = tmp >> 32n;
        local.get $tmp
        i64.const 32 ;; 32n
        i64.shr_u ;; tmp >> 32n
        local.set $C ;; let C = tmp >> 32n

        (br_if 0 (i32.ne (i32.const 96)
          (local.tee $j (i32.add (local.get $j) (i32.const 8)))
        ))
      )

      ;; t[11] = A + C;
      (i32.add (local.get $t) (i32.const 88)) ;; t[11] =
      local.get $A ;; A
      local.get $C ;; C
      i64.add ;; A + C
      i64.store ;; t[11] = A + C

      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )

    ;;  for (let i = 0; i < 96; i+=8) {
    ;;    xy[i] = t[i];
    ;;  }
    (local.set $i (i32.const 0))
    (loop
      (i32.add (local.get $xy) (local.get $i)) ;; xy[i] = 
      (i64.load (i32.add (local.get $t) (local.get $i))) ;; t[i]
      i64.store ;; xy[i] = t[i]
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
  )

  (func $add.381.12_leg (param $out i32) (param $x i32) (param $y i32)
    (local $i i32) (local $tmp i64) (local $carry i64) (local $p i64)

    ;; let carry = 0n;
    (local.set $carry (i64.const 0)) ;; let carry = 0n

    ;; for (let i = 0; i < 96; i+=8) {
    (local.set $i (i32.const 0))
    (loop
      ;; let tmp = x[i] + y[i] + carry;
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load (i32.add (local.get $y) (local.get $i))) ;; y[i]
      local.get $carry ;; carry
      i64.add ;; x[i] + y[i]
      i64.add ;; x[i] + y[i] + carry
      local.set $tmp ;; let tmp = x[i] + y[i] + carry
      ;; out[i] = tmp & 0xffffffffn;
      (i32.add (local.get $out) (local.get $i)) ;; out[i]
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      i64.store ;; out[i] = tmp & 0xffffffffn
      ;; carry = tmp >> 32n;
      local.get $tmp
      i64.const 32 ;; 32n
      i64.shr_u ;; tmp >> 32n
      local.set $carry ;; let carry = tmp >> 32n
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
    ;; }
    ;; for (let i = 88; i >= 0; i-=8) {
    (local.set $i (i32.const 88))
    (loop
      ;; if (t[i] < 2p[i]) return
      (i64.load (i32.add (local.get $out) (local.get $i))) ;; out[i]
      local.set $tmp
      (i64.load (i32.add (global.get $p2) (local.get $i))) ;; 2p[i]
      local.set $p
      (i64.lt_u (local.get $tmp) (local.get $p))
      if return end
      ;; if (t[i] !== 2p[i]) break;
      (br_if 0 (i32.and
        (i64.eq (local.get $tmp) (local.get $p))
        (i32.ne (i32.const -8)
        (local.tee $i (i32.sub (local.get $i) (i32.const 8)))
      )))
    )
    ;; if we're here, t >= 2p, so do t - 2p to get back in 0,..,2p-1
    ;; let carry = 0n;
    (local.set $carry (i64.const 0))
    ;; for (let i = 0; i < 96; i+=8) {
    (local.set $i (i32.const 0))
    (loop
      ;; let tmp = out[i] - 2p[i] - carry + 0x100000000n;
      i64.const 0x100000000
      (i64.load (i32.add (local.get $out) (local.get $i)))
      i64.add
      (i64.load (i32.add (global.get $p2) (local.get $i)))
      i64.sub
      local.get $carry
      i64.sub
      local.set $tmp
      ;; out[i] = tmp & 0xffffffffn;
      (i32.add (local.get $out) (local.get $i))
      (i64.and (local.get $tmp) (i64.const 0xffffffff))
      i64.store
      ;; carry = 1n - (tmp >> 32n);
      i64.const 1
      (i64.shr_u (local.get $tmp) (i64.const 32))
      i64.sub
      local.set $carry
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
  )

  (func $addNoReduce.381.12_leg (param $out i32) (param $x i32) (param $y i32)
    (local $i i32) (local $tmp i64) (local $carry i64) (local $p i64)
    ;; let carry = 0n;
    (local.set $carry (i64.const 0)) ;; let carry = 0n
    ;; for (let i = 0; i < 96; i+=8) {
    (local.set $i (i32.const 0))
    (loop
      ;; let tmp = x[i] + y[i] + carry;
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load (i32.add (local.get $y) (local.get $i))) ;; y[i]
      local.get $carry ;; carry
      i64.add ;; x[i] + y[i]
      i64.add ;; x[i] + y[i] + carry
      local.set $tmp ;; let tmp = x[i] + y[i] + carry
      ;; out[i] = tmp & 0xffffffffn;
      (i32.add (local.get $out) (local.get $i)) ;; out[i]
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      i64.store ;; out[i] = tmp & 0xffffffffn
      ;; carry = tmp >> 32n;
      local.get $tmp
      i64.const 32 ;; 32n
      i64.shr_u ;; tmp >> 32n
      local.set $carry ;; let carry = tmp >> 32n
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
  )

  (func $subtract.381.12_leg (param $out i32) (param $x i32) (param $y i32)
    (local $i i32) (local $tmp i64) (local $borrow i64) (local $p i64)

    ;; let borrow = 0n;
    (local.set $borrow (i64.const 0))

    ;; for (let i = 0; i < 96; i+=8) {
    (local.set $i (i32.const 0))
    (loop
      ;; let tmp = 2**32 + x[i] - y[i] - borrow;
      i64.const 0x100000000 ;; 2**32
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      i64.add ;; 2**32 + x[i]
      (i64.load (i32.add (local.get $y) (local.get $i))) ;; y[i]
      i64.sub ;; 2**32 + x[i] - y[i]
      local.get $borrow ;; borrow
      i64.sub ;; 2**32 + x[i] - y[i] - borrow
      local.set $tmp ;; let tmp = 2**32 + x[i] - y[i] - borrow
      ;; out[i] = tmp & 0xffffffffn;
      (i32.add (local.get $out) (local.get $i)) ;; out[i]
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      i64.store ;; out[i] = tmp & 0xffffffffn
      ;; borrow = 1 - (tmp >> 32n);
      i64.const 1
      (i64.shr_u (local.get $tmp) (i64.const 32))
      i64.sub
      local.set $borrow
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
    ;; if (borrow === 0) return
    (local.get $borrow) (i64.const 0) i64.eq
    if return end
    ;; if we're here, y > x and out = x - y + R, while we want x - y + 2p
    ;; so do (out - (R - 2p))
    ;; let borrow = 0n;
    (local.set $borrow (i64.const 0))
    ;; for (let i = 0; i < 96; i+=8) {
    (local.set $i (i32.const 0))
    (loop
      ;; let tmp = 2**32 + out[i] - rm2p[i] - borrow;
      i64.const 0x100000000
      (i64.load (i32.add (local.get $out) (local.get $i)))
      i64.add
      (i64.load (i32.add (global.get $rm2p) (local.get $i)))
      i64.sub
      local.get $borrow
      i64.sub
      local.set $tmp
      ;; out[i] = tmp & 0xffffffffn;
      (i32.add (local.get $out) (local.get $i))
      (i64.and (local.get $tmp) (i64.const 0xffffffff))
      i64.store
      ;; borrow = 1n - (tmp >> 32n);
      i64.const 1
      (i64.shr_u (local.get $tmp) (i64.const 32))
      i64.sub
      local.set $borrow
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
  )

  (func $subtractNoReduce.381.12_leg (param $out i32) (param $x i32) (param $y i32)
    (local $i i32) (local $tmp i64) (local $borrow i64) (local $p i64)
    (local.set $borrow (i64.const 0))
    ;; for (let i = 0; i < 96; i+=8) {
    (local.set $i (i32.const 0))
    (loop
      ;; let tmp = 2**32 + x[i] - y[i] - borrow;
      i64.const 0x100000000 ;; 2**32
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      i64.add ;; 2**32 + x[i]
      (i64.load (i32.add (local.get $y) (local.get $i))) ;; y[i]
      i64.sub ;; 2**32 + x[i] - y[i]
      local.get $borrow ;; borrow
      i64.sub ;; 2**32 + x[i] - y[i] - borrow
      local.set $tmp ;; let tmp = 2**32 + x[i] - y[i] - borrow
      ;; out[i] = tmp & 0xffffffffn;
      (i32.add (local.get $out) (local.get $i)) ;; out[i]
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      i64.store ;; out[i] = tmp & 0xffffffffn
      ;; borrow = 1 - (tmp >> 32n);
      i64.const 1
      (i64.shr_u (local.get $tmp) (i64.const 32))
      i64.sub
      local.set $borrow
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
  )

  ;; takes x, 0 <= x < 2p, and modifies it in-place ensuring 0 <= x < p
  ;; pseudo-code:
  ;; if (x < p) return;
  ;; x -= p;
  (func $reduce.381.12_leg (param $x i32)
    (local $i i32) (local $tmp i64) (local $borrow i64) (local $p i64)
    ;; for (let i = 88; i >= 0; i-=8) {
    (local.set $i (i32.const 88))
    (loop
      ;; load x[i], p[i] into local variables
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      local.set $tmp
      (i64.load (i32.add (global.get $p) (local.get $i))) ;; p[i]
      local.set $p
      ;; if (x[i] < p[i]) return
      (i64.lt_u (local.get $tmp) (local.get $p))
      if return end
      ;; if (x[i] === p[i] && (i -= 8) !== -8) continue;
      (br_if 0 (i32.and
        (i64.eq (local.get $tmp) (local.get $p))
        (i32.ne (i32.const -8)
        (local.tee $i (i32.sub (local.get $i) (i32.const 8)))
      )))
    )
    ;; if we're here, x >= p. since we assume x < 2p, we do x - p to reduce
    (local.set $borrow (i64.const 0))
    ;; for (let i = 0; i < 96; i+=8) {
    (local.set $i (i32.const 0))
    (loop
      ;; let tmp = x[i] - p[i] - borrow + 0x100000000n;
      i64.const 0x100000000
      (i64.load (i32.add (local.get $x) (local.get $i)))
      i64.add
      (i64.load (i32.add (global.get $p) (local.get $i)))
      i64.sub
      local.get $borrow
      i64.sub
      local.set $tmp
      ;; x[i] = tmp & 0xffffffffn;
      (i32.add (local.get $x) (local.get $i))
      (i64.and (local.get $tmp) (i64.const 0xffffffff))
      i64.store
      ;; carry = 1n - (tmp >> 32n);
      i64.const 1
      (i64.shr_u (local.get $tmp) (i64.const 32))
      i64.sub
      local.set $borrow
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
  )

  (func $equals.381.12_leg (param $x i32) (param $y i32) (result i32)
    (local $i i32)
    (local.set $i (i32.const 0))
    (loop
      (i64.load (i32.add (local.get $x) (local.get $i)))
      (i64.load (i32.add (local.get $y) (local.get $i)))
      i64.ne
      if (return (i32.const 0)) end
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
    (i32.const 1)
  )

  (func $isZero.381.12_leg (param $x i32) (result i32)
    (local $i i32)
    (local.set $i (i32.const 0))
    (loop
      (i64.load (i32.add (local.get $x) (local.get $i)))
      (i64.const 0)
      i64.ne
      if (return (i32.const 0)) end
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
    (i32.const 1)
  )

  (func $isGreater.381.12_leg (param $x i32) (param $y i32) (result i32)
    (local $i i32) (local $xi i64) (local $yi i64)
    (local.set $i (i32.const 88))
    (loop
      (i64.load (i32.add (local.get $x) (local.get $i)))
      local.set $xi
      (i64.load (i32.add (local.get $y) (local.get $i)))
      local.set $yi
      (i64.gt_u (local.get $xi) (local.get $yi))
      if (return (i32.const 1)) end
      (br_if 0 (i32.and
        (i64.eq (local.get $xi) (local.get $yi))
        (i32.ne (i32.const -8)
        (local.tee $i (i32.sub (local.get $i) (i32.const 8)))
      )))
    )
    (i32.const 0)
  )

  (func $makeOdd.381.12_leg (param $u i32) (param $s i32) (result i32)
    (local $k i32) (local $u0 i64)
    ;; k = count_trailing_zeroes(u[0]) -- by how much we have to right-shift u
    (i64.load (local.get $u))
    local.tee $u0
    i64.ctz i32.wrap_i64
    local.tee $k
    ;; if it's 64 (i.e., u[0] === 0), shift by a whole word and call this function again
    ;; (note: u is not supposed to be 0, so u[0] = 0 implies that u is divisible by 2^32)
    (i32.const 64) (i32.eq)
    if 
      (call $shiftByWord.381.12_leg (local.get $u) (local.get $s))
      (call $makeOdd.381.12_leg (local.get $u) (local.get $s)) ;; returns k'
      i32.const 32
      i32.add
      return
    end
    ;; here, we know that k = 0,...,31
    ;; TODO
  )

  (func $shiftByWord.381.12_leg (param $u i32) (param $s i32)
    (local $i i32)
    (local.set $i (i32.const 0))
    (loop
      ;; u[i] = u[i+1]
      (i64.store 
        (i32.add (local.get $u) (local.get $i))
        (i64.load (i32.add (i32.add (local.get $u) (local.get $i)) (i32.const 8)))
      )
      ;; s[11-i] = s[11-i-1]
      (i64.store offset=88
        (i32.sub (local.get $s) (local.get $i))
        (i64.load offset=88 (i32.sub (i32.sub (local.get $s) (local.get $i)) (i32.const 8)))
      )
      (br_if 0 (i32.ne (i32.const 88)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )
    ;; s[0] = 0
    (i64.store (local.get $s) (i64.const 0))
    ;; u[11] = 0
    (i64.store offset=88 (local.get $u) (i64.const 0))
  )

  (func $alloc_zero (param $length i32) (result i32)
		(local $pointer i32)
		(local.set $pointer (call $alloc (local.get $length)))
		(call $zero (local.get $pointer) (local.get $length))
		local.get $pointer
	)

	(func $zero (param $x i32) (param $xLength i32)
		(local $I i32)
		(local $end i32)
		(local.set $end (i32.add (local.get $x) (local.get $xLength)))
		(local.set $I (local.get $x))
		(loop
			(i32.store8 (local.get $I) (i32.const 0))
			(br_if 0 (i32.ne (local.get $end)
				(local.tee $I (i32.add (local.get $I) (i32.const 1)))
			))
		)
	)
)