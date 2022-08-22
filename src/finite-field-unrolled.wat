(module
  (import "watever/memory.wat" "alloc" (func $alloc (param i32) (result i32)))
  (import "watever/memory.wat" "memory" (memory 1))
  (import "./finite-field-constants.wat" "p" (global $p i32))
  (import "./finite-field-constants.wat" "p2" (global $p2 i32))
  (import "./finite-field-constants.wat" "rm2p" (global $rm2p i32))
  (import "./finite-field-constants.wat" "mu" (global $mu i64))

  (export "multiply" (func $multiply.381.12_leg))

  (func $multiply.381.12_leg (param $xy i32) (param $x i32) (param $y i32)
    ;; x and y are 12 i64 legs which represent 12 base 2^32 digits, s.t. 0 <= x, y < 2p
    ;; xy === x*y/R mod p and 0 <= xy < 2p, where R = 2^384 is the montgomery radix
    ;; all 12xi64s are stored little-endian (small first)
    (local $i i32) (local $j i32) (local $q i32) (local $t i32)
    (local $C i64) (local $A i64) (local $tmp i64) (local $m i64)
    (local $xi i64)
    (local $t0 i64) (local $t1 i64) (local $t2 i64) (local $t3 i64)
    (local $t4 i64) (local $t5 i64) (local $t6 i64) (local $t7 i64)
    (local $t8 i64) (local $t9 i64) (local $t10 i64) (local $t11 i64)

    (local.set $q (global.get $p))

    ;; for (let i = 0; i < 96; i+=8) {
    (local.set $i (i32.const 0))
    (loop
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      local.set $xi

      ;; j=0 -- different from other iterations

      ;; let tmp = t[0] + x[i] * y[0];
      (local.get $t0) ;; t[0]
      local.get $xi
      (i64.load (local.get $y)) ;; y[i]
      i64.mul i64.add ;; t[0] + x[i] * y[0]
      local.set $tmp ;; let tmp = t[0] + x[i] * y[0]
      ;; let A = tmp >> 32n
      (i64.shr_u (local.get $tmp) (i64.const 32)) ;; tmp >> 32n
      local.set $A ;; 
      ;; tmp = tmp & 0xffffffffn
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      local.set $tmp

      ;; let m = (tmp * mu0) & 0xffffffffn;
      (local.get $tmp) (global.get $mu) i64.mul
      (i64.const 0xffffffff) i64.and ;; (tmp * mu0) & 0xffffffffn
      local.set $m ;; let m = (tmp * mu0) & 0xffffffffn

      ;; let C = (tmp + m * q[0]) >> 32n;
      local.get $tmp ;; tmp
      local.get $m ;; m
      (i64.load (local.get $q)) ;; q[0]
      i64.mul i64.add (i64.const 32) ;; tmp + m * q[0]
      i64.shr_u (local.set $C) ;; let C = (tmp + m * q[0]) >> 32n

      ;; j = 8
      ;; let tmp = t[j] + x[i] * y[j] + A;
      (local.get $t1) ;; t[j]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load offset=8 (local.get $y)) ;; y[j]
      i64.mul (local.get $A) i64.add i64.add ;; t[j] + x[i] * y[j] + A
      local.set $tmp
      ;;  A = tmp >> 32n;
      (local.set $A (i64.shr_u (local.get $tmp) (i64.const 32)))
      ;; tmp = (tmp & 0xffffffffn) + m * q[j] + C;
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      (i64.mul (local.get $m) (i64.load offset=8 (local.get $q))) ;; m * q[j]
      (local.get $C) i64.add i64.add ;; (tmp & 0xffffffffn) + m * q[j] + C
      local.set $tmp ;; let tmp = (tmp & 0xffffffffn) + m * q[j] + C
      ;; t[j - 1] = tmp & 0xffffffffn;
      (local.set $t0 ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      )
      ;; C = tmp >> 32n;
      (local.set $C (i64.shr_u (local.get $tmp) (i64.const 32)))
      
      ;; j = 16
      ;; let tmp = t[j] + x[i] * y[j] + A;
      (local.get $t2) ;; t[j]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load offset=16 (local.get $y)) ;; y[j]
      i64.mul (local.get $A) i64.add i64.add ;; t[j] + x[i] * y[j] + A
      local.set $tmp
      ;;  A = tmp >> 32n;
      (local.set $A (i64.shr_u (local.get $tmp) (i64.const 32)))
      ;; tmp = (tmp & 0xffffffffn) + m * q[j] + C;
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      (i64.mul (local.get $m) (i64.load offset=16 (local.get $q))) ;; m * q[j]
      (local.get $C) i64.add i64.add ;; (tmp & 0xffffffffn) + m * q[j] + C
      local.set $tmp ;; let tmp = (tmp & 0xffffffffn) + m * q[j] + C
      ;; t[j - 1] = tmp & 0xffffffffn;
      (local.set $t1 ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      )
      ;; C = tmp >> 32n;
      (local.set $C (i64.shr_u (local.get $tmp) (i64.const 32)))

      ;; j = 24
      ;; let tmp = t[j] + x[i] * y[j] + A;
      (local.get $t3) ;; t[j]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load offset=24 (local.get $y)) ;; y[j]
      i64.mul (local.get $A) i64.add i64.add ;; t[j] + x[i] * y[j] + A
      local.set $tmp
      ;;  A = tmp >> 32n;
      (local.set $A (i64.shr_u (local.get $tmp) (i64.const 32)))
      ;; tmp = (tmp & 0xffffffffn) + m * q[j] + C;
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      (i64.mul (local.get $m) (i64.load offset=24 (local.get $q))) ;; m * q[j]
      (local.get $C) i64.add i64.add ;; (tmp & 0xffffffffn) + m * q[j] + C
      local.set $tmp ;; let tmp = (tmp & 0xffffffffn) + m * q[j] + C
      ;; t[j - 1] = tmp & 0xffffffffn;
      (local.set $t2 ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      )
      ;; C = tmp >> 32n;
      (local.set $C (i64.shr_u (local.get $tmp) (i64.const 32)))

      ;; j = 32
      ;; let tmp = t[j] + x[i] * y[j] + A;
      (local.get $t4) ;; t[j]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load offset=32 (local.get $y)) ;; y[j]
      i64.mul (local.get $A) i64.add i64.add ;; t[j] + x[i] * y[j] + A
      local.set $tmp
      ;;  A = tmp >> 32n;
      (local.set $A (i64.shr_u (local.get $tmp) (i64.const 32)))
      ;; tmp = (tmp & 0xffffffffn) + m * q[j] + C;
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      (i64.mul (local.get $m) (i64.load offset=32 (local.get $q))) ;; m * q[j]
      (local.get $C) i64.add i64.add ;; (tmp & 0xffffffffn) + m * q[j] + C
      local.set $tmp ;; let tmp = (tmp & 0xffffffffn) + m * q[j] + C
      ;; t[j - 1] = tmp & 0xffffffffn;
      (local.set $t3 ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      )
      ;; C = tmp >> 32n;
      (local.set $C (i64.shr_u (local.get $tmp) (i64.const 32)))

      ;; j = 40
      ;; let tmp = t[j] + x[i] * y[j] + A;
      (local.get $t5) ;; t[j]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load offset=40 (local.get $y)) ;; y[j]
      i64.mul (local.get $A) i64.add i64.add ;; t[j] + x[i] * y[j] + A
      local.set $tmp
      ;;  A = tmp >> 32n;
      (local.set $A (i64.shr_u (local.get $tmp) (i64.const 32)))
      ;; tmp = (tmp & 0xffffffffn) + m * q[j] + C;
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      (i64.mul (local.get $m) (i64.load offset=40 (local.get $q))) ;; m * q[j]
      (local.get $C) i64.add i64.add ;; (tmp & 0xffffffffn) + m * q[j] + C
      local.set $tmp ;; let tmp = (tmp & 0xffffffffn) + m * q[j] + C
      ;; t[j - 1] = tmp & 0xffffffffn;
      (local.set $t4 ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      )
      ;; C = tmp >> 32n;
      (local.set $C (i64.shr_u (local.get $tmp) (i64.const 32)))

      ;; j = 48
      ;; let tmp = t[j] + x[i] * y[j] + A;
      (local.get $t6) ;; t[j]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load offset=48 (local.get $y)) ;; y[j]
      i64.mul (local.get $A) i64.add i64.add ;; t[j] + x[i] * y[j] + A
      local.set $tmp
      ;;  A = tmp >> 32n;
      (local.set $A (i64.shr_u (local.get $tmp) (i64.const 32)))
      ;; tmp = (tmp & 0xffffffffn) + m * q[j] + C;
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      (i64.mul (local.get $m) (i64.load offset=48 (local.get $q))) ;; m * q[j]
      (local.get $C) i64.add i64.add ;; (tmp & 0xffffffffn) + m * q[j] + C
      local.set $tmp ;; let tmp = (tmp & 0xffffffffn) + m * q[j] + C
      ;; t[j - 1] = tmp & 0xffffffffn;
      (local.set $t5 ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      )
      ;; C = tmp >> 32n;
      (local.set $C (i64.shr_u (local.get $tmp) (i64.const 32)))

      ;; j = 56
      ;; let tmp = t[j] + x[i] * y[j] + A;
      (local.get $t7) ;; t[j]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load offset=56 (local.get $y)) ;; y[j]
      i64.mul (local.get $A) i64.add i64.add ;; t[j] + x[i] * y[j] + A
      local.set $tmp
      ;;  A = tmp >> 32n;
      (local.set $A (i64.shr_u (local.get $tmp) (i64.const 32)))
      ;; tmp = (tmp & 0xffffffffn) + m * q[j] + C;
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      (i64.mul (local.get $m) (i64.load offset=56 (local.get $q))) ;; m * q[j]
      (local.get $C) i64.add i64.add ;; (tmp & 0xffffffffn) + m * q[j] + C
      local.set $tmp ;; let tmp = (tmp & 0xffffffffn) + m * q[j] + C
      ;; t[j - 1] = tmp & 0xffffffffn;
      (local.set $t6 ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      )
      ;; C = tmp >> 32n;
      (local.set $C (i64.shr_u (local.get $tmp) (i64.const 32)))

      ;; j = 64
      ;; let tmp = t[j] + x[i] * y[j] + A;
      (local.get $t8) ;; t[j]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load offset=64 (local.get $y)) ;; y[j]
      i64.mul (local.get $A) i64.add i64.add ;; t[j] + x[i] * y[j] + A
      local.set $tmp
      ;;  A = tmp >> 32n;
      (local.set $A (i64.shr_u (local.get $tmp) (i64.const 32)))
      ;; tmp = (tmp & 0xffffffffn) + m * q[j] + C;
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      (i64.mul (local.get $m) (i64.load offset=64 (local.get $q))) ;; m * q[j]
      (local.get $C) i64.add i64.add ;; (tmp & 0xffffffffn) + m * q[j] + C
      local.set $tmp ;; let tmp = (tmp & 0xffffffffn) + m * q[j] + C
      ;; t[j - 1] = tmp & 0xffffffffn;
      (local.set $t7 ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      )
      ;; C = tmp >> 32n;
      (local.set $C (i64.shr_u (local.get $tmp) (i64.const 32)))

      ;; j = 72
      ;; let tmp = t[j] + x[i] * y[j] + A;
      (local.get $t9) ;; t[j]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load offset=72 (local.get $y)) ;; y[j]
      i64.mul (local.get $A) i64.add i64.add ;; t[j] + x[i] * y[j] + A
      local.set $tmp
      ;;  A = tmp >> 32n;
      (local.set $A (i64.shr_u (local.get $tmp) (i64.const 32)))
      ;; tmp = (tmp & 0xffffffffn) + m * q[j] + C;
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      (i64.mul (local.get $m) (i64.load offset=72 (local.get $q))) ;; m * q[j]
      (local.get $C) i64.add i64.add ;; (tmp & 0xffffffffn) + m * q[j] + C
      local.set $tmp ;; let tmp = (tmp & 0xffffffffn) + m * q[j] + C
      ;; t[j - 1] = tmp & 0xffffffffn;
      (local.set $t8 ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      )
      ;; C = tmp >> 32n;
      (local.set $C (i64.shr_u (local.get $tmp) (i64.const 32)))

      ;; j = 80
      ;; let tmp = t[j] + x[i] * y[j] + A;
      (local.get $t10) ;; t[j]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load offset=80 (local.get $y)) ;; y[j]
      i64.mul (local.get $A) i64.add i64.add ;; t[j] + x[i] * y[j] + A
      local.set $tmp
      ;;  A = tmp >> 32n;
      (local.set $A (i64.shr_u (local.get $tmp) (i64.const 32)))
      ;; tmp = (tmp & 0xffffffffn) + m * q[j] + C;
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      (i64.mul (local.get $m) (i64.load offset=80 (local.get $q))) ;; m * q[j]
      (local.get $C) i64.add i64.add ;; (tmp & 0xffffffffn) + m * q[j] + C
      local.set $tmp ;; let tmp = (tmp & 0xffffffffn) + m * q[j] + C
      ;; t[j - 1] = tmp & 0xffffffffn;
      (local.set $t9 ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      )
      ;; C = tmp >> 32n;
      (local.set $C (i64.shr_u (local.get $tmp) (i64.const 32)))
      
      ;; j = 88
      ;; let tmp = t[j] + x[i] * y[j] + A;
      (local.get $t11) ;; t[j]
      (i64.load (i32.add (local.get $x) (local.get $i))) ;; x[i]
      (i64.load offset=88 (local.get $y)) ;; y[j]
      i64.mul (local.get $A) i64.add i64.add ;; t[j] + x[i] * y[j] + A
      local.set $tmp
      ;;  A = tmp >> 32n;
      (local.set $A (i64.shr_u (local.get $tmp) (i64.const 32)))
      ;; tmp = (tmp & 0xffffffffn) + m * q[j] + C;
      (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      (i64.mul (local.get $m) (i64.load offset=88 (local.get $q))) ;; m * q[j]
      (local.get $C) i64.add i64.add ;; (tmp & 0xffffffffn) + m * q[j] + C
      local.set $tmp ;; let tmp = (tmp & 0xffffffffn) + m * q[j] + C
      ;; t[j - 1] = tmp & 0xffffffffn;
      (local.set $t10 ;; t[j - 1] = 
        (i64.and (local.get $tmp) (i64.const 0xffffffff)) ;; tmp & 0xffffffffn
      )
      ;; C = tmp >> 32n;
      (local.set $C (i64.shr_u (local.get $tmp) (i64.const 32)))

      ;; t[11] = A + C;
      (local.set $t11
        (i64.add (local.get $A) (local.get $C))
      )
      
      (br_if 0 (i32.ne (i32.const 96)
        (local.tee $i (i32.add (local.get $i) (i32.const 8)))
      ))
    )

    ;;  for (let i = 0; i < 96; i+=8) {
    ;;    xy[i] = t[i];
    ;;  }
    (i64.store offset=00 (local.get $xy) (local.get $t0))
    (i64.store offset=08 (local.get $xy) (local.get $t1))
    (i64.store offset=16 (local.get $xy) (local.get $t2))
    (i64.store offset=24 (local.get $xy) (local.get $t3))
    (i64.store offset=32 (local.get $xy) (local.get $t4))
    (i64.store offset=40 (local.get $xy) (local.get $t5))
    (i64.store offset=48 (local.get $xy) (local.get $t6))
    (i64.store offset=56 (local.get $xy) (local.get $t7))
    (i64.store offset=64 (local.get $xy) (local.get $t8))
    (i64.store offset=72 (local.get $xy) (local.get $t9))
    (i64.store offset=80 (local.get $xy) (local.get $t10))
    (i64.store offset=88 (local.get $xy) (local.get $t11))
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