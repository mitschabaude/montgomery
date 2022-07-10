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
  (export "storeField" (func $storeField))
  (export "storeFieldIn" (func $storeFieldIn))
  (export "emptyField" (func $emptyField))
  (export "readField#lift" (func $readField))
  (export "freeField" (func $freeField))

  ;; note: wasm is LITTLE-ENDIAN (least significant byte first),
  ;; but (as always) every single byte is stored big-endian (most significant bit first)
  ;; so the int64 0x0000000001020304 is stored as "\04\03\02\01\00\00\00\00"
  ;; we also store a number of i64 legs in LITTLE-ENDIAN form (small first)
  (global $p i32 (i32.const 0)) ;; 12 x i64 = 96 bytes
  (data (i32.const 0)
    ;; 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn
    "\ab\aa\ff\ff\00\00\00\00" ;; ffffaaab
    "\ff\ff\fe\b9\00\00\00\00" ;; b9feffff
    "\ff\ff\53\b1\00\00\00\00" ;; b153ffff
    "\fe\ff\ab\1e\00\00\00\00" ;; 1eabfffe
    "\24\f6\b0\f6\00\00\00\00" ;; f6b0f624
    "\a0\d2\30\67\00\00\00\00" ;; 6730d2a0
    "\bf\12\85\f3\00\00\00\00" ;; f38512bf
    "\84\4b\77\64\00\00\00\00" ;; 64774b84
    "\d7\ac\4b\43\00\00\00\00" ;; 434bacd7
    "\b6\a7\1b\4b\00\00\00\00" ;; 4b1ba7b6
    "\9a\e6\7f\39\00\00\00\00" ;; 397fe69a
    "\ea\11\01\1a\00\00\00\00" ;; 1a0111ea
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
  (func $readField (param $x i32) (result i32)
    (call $lift_bytes (local.get $x))
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