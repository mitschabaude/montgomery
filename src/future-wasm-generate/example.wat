(module
  (type (;0;) (func (param i32)))
  (type (;1;) (func (param funcref)))
  (type (;2;) (func (param i32 i32) (result i32)))
  (type (;3;) (func))
  (type (;4;) (func (param i32) (result i32)))
  (import "*" "f0" (func (;0;) (type 0)))
  (import "*" "f1" (func (;1;) (type 1)))
  (import "*" "g0" (global (;0;) i64))
  (func (;2;) (type 2) (param i32 i32) (result i32)
    (local i32)
    ref.func 3
    call 1
    global.get 1
    i32.const 0
    call_indirect (type 1)
    local.get 0
    local.get 1
    if  ;; label = @1
      local.get 0
      call 0
    end
    local.set 2
    local.get 2
    i32.const 5
    call 3)
  (func (;3;) (type 2) (param i32 i32) (result i32)
    (local i32 i32)
    i32.const 0
    local.get 0
    i32.add
    local.get 1
    i32.add
    block (param i32) (result i32)  ;; label = @1
      local.tee 2
      call 0
      loop  ;; label = @2
        local.get 3
        call 0
        local.get 3
        i32.const 1
        i32.add
        local.set 3
        local.get 3
        i32.const 5
        i32.eq
        if  ;; label = @3
          local.get 2
          return
          call 0
        end
        br 0 (;@2;)
        local.get 3
        i32.ne
        br_if 0 (;@2;)
      end
      local.get 2
    end)
  (table (;0;) 4 funcref)
  (memory (;0;) 1 65536)
  (global (;1;) funcref (ref.func 3))
  (export "exportedFunc" (func 2))
  (export "importedGlobal" (global 0))
  (elem (;0;) (i32.const 0) funcref (ref.func 1) (ref.func 3) (ref.null func) (ref.null func))
  (data (;0;) (i32.const 0) "\01\02\03\04\05\06\07\08\09\0a\0b"))
