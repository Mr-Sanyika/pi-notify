import { describe, expect, it } from 'vitest'

import { oscNotifySequences, wrapTmuxPassthrough } from './osc.js'

const ESC = '\x1b'
const BEL = '\x07'

describe('oscNotifySequences', () => {
  it('emits OSC 777 first, then OSC 9, when both are enabled', () => {
    expect(
      oscNotifySequences('title', 'body', { osc777: true, osc9: true }),
    ).toEqual([`${ESC}]777;notify;title;body${BEL}`, `${ESC}]9;body${BEL}`])
  })

  it('emits only OSC 9 when osc777 is off', () => {
    expect(
      oscNotifySequences('title', 'body', { osc777: false, osc9: true }),
    ).toEqual([`${ESC}]9;body${BEL}`])
  })

  it('emits only OSC 777 when osc9 is off', () => {
    expect(
      oscNotifySequences('title', 'body', { osc777: true, osc9: false }),
    ).toEqual([`${ESC}]777;notify;title;body${BEL}`])
  })

  it('emits nothing when both are off', () => {
    expect(
      oscNotifySequences('title', 'body', { osc777: false, osc9: false }),
    ).toEqual([])
  })

  it('strips BEL, ESC, and flattens newlines in title and body', () => {
    expect(
      oscNotifySequences('ti\r\ntle', 'bo\x1b]dy\nx', {
        osc777: true,
        osc9: false,
      }),
    ).toEqual([`${ESC}]777;notify;ti tle;bo]dy x${BEL}`])
  })

  it('strips semicolons from the title but keeps them in the body', () => {
    const [osc777, osc9] = oscNotifySequences('ti;tle', 'bo;dy', {
      osc777: true,
      osc9: true,
    })
    expect(osc777).toBe(`${ESC}]777;notify;title;bo;dy${BEL}`)
    // OSC 9 body must stay identical to the 777 body for body-keyed dedup.
    expect(osc9).toBe(`${ESC}]9;bo;dy${BEL}`)
  })
})

describe('wrapTmuxPassthrough', () => {
  it('wraps an OSC 9 sequence with the DCS tmux passthrough', () => {
    const wrapped = wrapTmuxPassthrough(`${ESC}]9;body${BEL}`)
    expect(wrapped.startsWith(`${ESC}Ptmux;`)).toBe(true)
    expect(wrapped.endsWith(`${ESC}\\`)).toBe(true)
    // The inner OSC's leading ESC must be doubled (classic bug to forget).
    expect(wrapped).toBe(`${ESC}Ptmux;${ESC}${ESC}]9;body${BEL}${ESC}\\`)
  })

  it('wraps an OSC 777 sequence and doubles only ESC bytes', () => {
    const raw = `${ESC}]777;notify;title;body${BEL}`
    const wrapped = wrapTmuxPassthrough(raw)
    expect(wrapped).toBe(
      `${ESC}Ptmux;${ESC}${ESC}]777;notify;title;body${BEL}${ESC}\\`,
    )
    // BEL is passed through as-is; only ESC bytes are doubled.
    expect(wrapped.split(BEL).length - 1).toBe(1)
  })
})
