import State from '../state'
import { OP, SIGNAL } from '../share/const'
import { getDptor, define, inherits, getGetter, getSetter } from '../share/utils'

function step(state: State) {
  const stack = state.stack
  const code = state.opCodes[state.pc]
  let signal = SIGNAL.NONE
  switch (code.op) {
    case OP.LOADK: stack[state.esp++] = code.val; break
    case OP.LOADV: stack[state.esp++] = state.context[code.val] && state.context[code.val].store; break
    case OP.ALLOC: {
        const ebp = state.ebpList[state.ebpList.length - 1]
        const storeVal = state.esp > ebp ? stack[--state.esp] : undefined
        state.context[code.val] = { store: storeVal }
        if (!ebp) {
          const globalPointer = state.symbols.get('window').pointer
          const globalVariable = state.context[globalPointer].store
          const globalVarName = state.symbols.globalVarName[code.val]
          define(globalVariable, globalVarName, { value: storeVal, writable: true, enumerable: true })
        }
        break
    }
    case OP.STORE: state.context[code.val].store = stack[--state.esp]; break
    case OP.BIOP: {
      const right = stack[--state.esp]
      const left = stack[--state.esp]
      switch (code.val) {
        // very often used
        case '+': stack[state.esp++] = left + right; break
        case '-': stack[state.esp++] = left - right; break
        case '*': stack[state.esp++] = left * right; break
        case '/': stack[state.esp++] = left / right; break
        case '==': stack[state.esp++] = left == right; break
        case '!=': stack[state.esp++] = left != right; break
        case '===': stack[state.esp++] = left === right; break
        case '!==': stack[state.esp++] = left !== right; break
        case '<': stack[state.esp++] = left < right; break
        case '<=': stack[state.esp++] = left <= right; break
        case '>': stack[state.esp++] = left > right; break
        case '>=': stack[state.esp++] = left >= right; break
        case '||': stack[state.esp++] = left || right; break
        case '&&': stack[state.esp++] = left && right; break
        case 'in': stack[state.esp++] = left in right; break
        case 'instanceof': stack[state.esp++] = left instanceof right; break
        // not quite often used
        case '**': stack[state.esp++] = left ** right; break
        case '%': stack[state.esp++] = left % right; break
        case '|': stack[state.esp++] = left | right; break
        case '^': stack[state.esp++] = left ^ right; break
        case '&': stack[state.esp++] = left & right; break
        case '<<': stack[state.esp++] = left << right; break
        case '>>': stack[state.esp++] = left >> right; break
        case '>>>': stack[state.esp++] = left >>> right; break
        default: throw new SyntaxError(`Unexpected token ${code.val}`)
      }
      break
    }
    case OP.UNOP: {
      const arg = stack[--state.esp]
      switch (code.val) {
        case '+': stack[state.esp++] = +arg; break
        case '-': stack[state.esp++] = -arg; break
        case '!': stack[state.esp++] = !arg; break
        case '~': stack[state.esp++] = ~arg; break
        case 'void': stack[state.esp++] = void arg; break
        case 'typeof': stack[state.esp++] = typeof arg; break
        case 'delete': throw new SyntaxError('delete is not implemented')
        default: throw new SyntaxError(`Unexpected token ${code.val}`)
      }
      break
    }
    case OP.JMP: state.pc = code.val - 1; break
    case OP.IF: stack[--state.esp] && (state.pc = code.val - 1); break
    case OP.IFNOT: !stack[--state.esp] && (state.pc = code.val - 1); break
    case OP.CSNE: stack[--state.esp] !== stack[state.esp - 1] && (state.pc = code.val - 1); break
    case OP.ARR: {
      const spread = code.val.concat()
      const newEsp = state.esp - spread.pop()
      const arrItems = stack.slice(newEsp, state.esp)
      state.esp = newEsp
      let arr: any[] = []
      for (let i = 0; i < arrItems.length; i++) {
        if (spread.indexOf(i) === -1) {
          arr.push(arrItems[i])
        } else {
          arr = [...arr, ...arrItems[i]]
        }
      }
      stack[state.esp++] = arr
      break
    }
    case OP.OBJ: {
      const object: any = {}
      const propKinds = code.val
      const newEsp = state.esp - propKinds.length * 2
      const keyValue = stack.slice(newEsp, state.esp)
      state.esp = newEsp
      for (let i = 0; i < propKinds.length * 2; i += 2) {
        const key = keyValue[i]
        const value = keyValue[i + 1]
        const kind = propKinds[i / 2]
        if (kind === 'init') {
          object[key] = value
        } else if (kind === 'get') {
          const oriDptor = getDptor(object, key)
          define(object, key, {
            get: value,
            set: oriDptor && oriDptor.set,
            enumerable: true,
            configurable: true
          })
        } else if (kind === 'set') {
          const oriDptor = getDptor(object, key)
          define(object, key, {
            get: oriDptor && oriDptor.get,
            set: value,
            enumerable: true,
            configurable: true
          })
        } else { // kind === 'sprd'
          Object.assign(object, value)
        }
      }
      stack[state.esp++] = object
      break
    }
    case OP.MGET: {
      const key = stack[--state.esp]
      const object = stack[--state.esp]
      if (object == undefined) {
        throw new TypeError(`Cannot read property '${key}' of ${object}`)
      }
      const superProto = code.val && stack[--state.esp]
      const getter = getGetter(superProto || object, key)
      stack[state.esp++] = getter ? getter.call(object) : object[key]
      break
    }
    case OP.MSET: {
      const key = stack[--state.esp]
      const object = stack[--state.esp]
      if (object == undefined) {
        throw new TypeError(`Cannot set property '${key}' of ${object}`)
      }
      const superProto = code.val && stack[--state.esp]
      const value = stack[--state.esp]
      const setter = getSetter(superProto || object, key)
      setter ? setter.call(object, value) : object[key] = value
      break
    }
    case OP.REST: {
      if (code.val === 'obj') {
        const newEsp = state.esp - code.remove
        const rmKeys = stack.slice(newEsp, state.esp)
        state.esp = newEsp
        const object = Object.assign({}, stack[--state.esp])
        for (let i = 0; i < rmKeys.length; i++) {
          delete object[rmKeys[i]]
        }
        stack[state.esp++] = object
      } else if (code.val === 'arr') {
        const arr = stack[--state.esp].slice(code.remove)
        stack[state.esp++] = arr
      } else { // code.val === 'func'
        const newEsp = state.ebpList[state.ebpList.length - 1]
        stack[state.esp++] = stack.slice(newEsp, state.esp).reverse()
        state.esp = newEsp
      }
      break
    }
    case OP.KOVS: {
      const kovs = []
      if (code.val) {
        for (const key in stack[--state.esp]) {
          kovs.push(key)
        }
      } else {
        const iterator = stack[--state.esp]
        if (!iterator[Symbol.iterator]) {
          throw new TypeError(`${JSON.stringify(iterator)} is not iterable`)
        }
        for (const value of iterator) {
          kovs.push(value)
        }
      }
      stack[state.esp++] = kovs
      stack[state.esp++] = kovs.length
      break
    }
    case OP.FUNC: {
      const beginPc = state.pc + 1 // the begin pc
      const endPc = code.end // the end pc

      const lexicalCtx = state.context.concat() // reserve the lexical context for function
      if (!code.generator && !code.async) {
        const func = function () {
          for (let i = arguments.length - 1; i > -1; i--) {
            stack[state.esp++] = arguments[i] // load arguments
          }
          if (!code.arrow) {
            stack[state.esp++] = arguments // load argument array itself
            stack[state.esp++] = this // load this
          }

          const resetPc = state.pc // reserve the current pc
          const resetCtx = state.context // reserve the current context
          state.pc = beginPc // offset pc to the function op codes
          state.context = lexicalCtx // set the context as the lexical context of function

          let signal = SIGNAL.NONE
          let ret: any
          while (state.pc < endPc) {
            signal = step(state)
            if (signal === SIGNAL.RET) {
              ret = stack[--state.esp]
              break
            }
          }
          
          state.pc = resetPc // reset to the current pc
          state.context = resetCtx // reset to the current context

          return ret
        }
        define(func, 'name', {
          value: code.val,
          configurable: true
        })
        define(func, 'length', {
          value: code.length,
          configurable: true
        })
        stack[state.esp++] = func
      } else {
        // const tmpFunc = function* () {
        //   for (let i = arguments.length - 1; i > -1; i--) {
        //     stack[state.esp++] = arguments[i] // load arguments
        //   }
        //   if (!code.arrow) {
        //     stack[state.esp++] = arguments // load argument array itself
        //     stack[state.esp++] = this // load this
        //   }
  
        //   const resetPc = state.pc // reserve the current pc
        //   const resetCtx = state.context // reserve the current context
        //   state.pc = beginPc // offset pc to the function op codes
        //   state.context = lexicalCtx // set the context as the lexical context of function
  
        //   while (state.pc < endPc) {
        //     const s = step(state)
        //     if (s === SIGNAL.RET) break
        //     else if (s === SIGNAL.YIELD) yield
        //   }
  
        //   state.pc = resetPc // reset to the current pc
        //   state.context = resetCtx // reset to the current context
        // }
        // if (code.async && code.generator) {
        //   stack[state.esp++] = function (: AsyncIterator<any> {
        //     const iterator = tmpFunc.apply(void 0, arguments)
        //     let last: Promise<any> = Promise.resolve()
        //     let hasCatch = false
        //     const run = (opts: runAsyncOptions) =>
        //       last = last
        //         .then(() => runAsync(iterator, assign({ fullRet: true }, opts)))
        //         .catch(err => {
        //           if (!hasCatch) {
        //             hasCatch = true
        //             return Promise.reject(err)
        //           }
        //         })
        //     const asyncIterator: AsyncIterator<any> = {
        //       next: (res?: any) => run({ res }),
        //       throw: (err?: any) => run({ err }),
        //       return: (ret?: any) => run({ ret })
        //     }
        //     if (typeof Symbol === 'function') {
        //       (asyncIterator as any)[Symbol.iterator] = function () { return this }
        //     }
        //     return asyncIterator
        //   })
        // } else if (code.async) {
        //   stack[state.esp++] = function ( {
        //     return runAsync(tmpFunc.apply(void 0, arguments))
        //   })
        // } else {
        //   stack[state.esp++] = tmpFunc
        // }
      }
      state.pc = endPc - 1
      break
    }
    case OP.CLS: {
      let superClass: any = null
      if (code.inherit) {
        superClass = stack[--state.esp]
      }
      let classCtor: any = null
      if (code.constructor) {
        classCtor = stack[--state.esp]
      }
      let ctor = function () {
        if  (classCtor) {
          const result = classCtor.apply(this, arguments)
          if (superClass && !this['#sval_es6_class_super_called#']) {
            throw new ReferenceError('Must call super constructor in derived class before returning from derived constructor')
          }
          return result
        } else if (superClass) {
          return superClass.apply(this, arguments)
        }
      }
      if (superClass) {
        inherits(ctor, superClass)
      }
      define(ctor, 'name', {
        value: code.val,
        configurable: true
      })
      define(ctor, '#sval_es6_class#', { value: true })
      stack[state.esp++] = ctor
      break
    }
    case OP.CMET: {
      const key = stack[--state.esp]
      const met = stack[--state.esp]
      const obj = code.static ? stack[state.esp - 1] : stack[state.esp - 1].prototype
      switch (code.val) {
        case 'get': {
          const oriDptor = getDptor(obj, key)
          define(obj, key, {
            get: met,
            set: oriDptor && oriDptor.set,
            configurable: true,
          })
          break
        }
        case 'set': {
          const oriDptor = getDptor(obj, key)
          define(obj, key, {
            get: oriDptor && oriDptor.get,
            set: met,
            configurable: true,
          })
          break
        }
        default: // kind is 'method'
          define(obj, key, {
            value: met,
            writable: true,
            configurable: true,
          })
      }
      break
    }
    case OP.CALL: {
      const func = stack[--state.esp]

      if (!code.super && func['#sval_es6_class#']) {
        throw new TypeError(`Class constructor ${func.name} cannot be invoked without 'new'`)
      }

      const obj = stack[--state.esp]

      const spread = code.val.concat()
      const newEsp = state.esp - spread.pop()
      const argsItems = stack.slice(newEsp, state.esp)
      state.esp = newEsp
      let args: any[] = []
      for (let i = 0; i < argsItems.length; i++) {
        if (spread.indexOf(i) === -1) {
          args.push(argsItems[i])
        } else {
          args = [...args, ...argsItems[i]]
        }
      }

      // push ebp here instead of inside functions
      // to avoid a wrong ebp list caused by throwing error in functions
      state.ebpList.push(state.esp)
      let result: any
      if (code.catch) {
        try {
          result = func.apply(obj, args)
        } catch (err) {
          result = err
          state.pc = code.catch.pc - 1
        }
      } else {
        result = func.apply(obj, args)
      }
      state.esp = state.ebpList.pop()
      stack[state.esp++] = result

      if (code.super) {
        if (obj['#sval_es6_class_super_called#']) {
          throw new ReferenceError('Super constructor may only be called once')
        } else {
          define(obj, '#sval_es6_class_super_called#', { value: true })
        }
      }

      break
    }
    case OP.NEW: {
      const ctor = stack[--state.esp]
      
      const spread = code.val.concat()
      const newEsp = state.esp - spread.pop()
      const argsItems = stack.slice(newEsp, state.esp)
      state.esp = newEsp
      let args: any[] = []
      for (let i = 0; i < argsItems.length; i++) {
        if (spread.indexOf(i) === -1) {
          args.push(argsItems[i])
        } else {
          args = [...args, ...argsItems[i]]
        }
      }

      // push ebp here instead of inside functions
      // to avoid a wrong ebp list caused by throwing error in functions
      state.ebpList.push(state.esp)
      let result: any
      if (code.catch) {
        try {
          result = new ctor(...args)
        } catch (err) {
          result = err
          state.pc = code.catch.pc - 1
        }
      } else {
        result = new ctor(...args)
      }
      state.esp = state.ebpList.pop()
      stack[state.esp++] = result
      break
    }
    case OP.RET: signal = SIGNAL.RET; break
    case OP.YIELD: signal = SIGNAL.YIELD; break
    case OP.AWAIT: signal = SIGNAL.AWAIT; break
    case OP.COPY: {
      const top = stack[state.esp - 1]
      stack[state.esp++] = top
      break
    }
    case OP.POP: --state.esp; break
    case OP.DBG: debugger; break
    case OP.THROW: {
      if (code.val) {
        state.pc = code.val.pc - 1
        break
      } else {
        throw stack[--state.esp]
      }
    }
    case OP.GC: state.esp = state.ebpList[state.ebpList.length - 1]; break
    default: throw new Error('Unknown instruct code')
  }
  state.pc++
  return signal
}

export default function execute(state: State) {
  while (state.pc < state.opCodes.length) step(state)
}