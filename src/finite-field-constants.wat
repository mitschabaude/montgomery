(module
  (export "p" (global $p))
  (export "p2" (global $p2))
  (export "rm2p" (global $rm2p))
  (export "mu" (global $mu))

  (global $mu i64 (i64.const 0x00000000fffcfffd)) ;; -p^(-1) mod 2^32

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
)