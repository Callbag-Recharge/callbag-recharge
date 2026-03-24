---
outline: [2, 3]
---

# Extra API Index

This page is a quick index for `extra` APIs. Detailed reference is generated in `site/api/*.md`.

## Import

```ts
// Barrel import
import { map, filter, scan } from "callbag-recharge/extra";

// Per-function import
import { switchMap } from "callbag-recharge/extra/switchMap";
```

## Sources

- [fromAny()](/api/fromAny)
- [fromIter()](/api/fromIter)
- [fromAsyncIter()](/api/fromAsyncIter)
- [fromEvent()](/api/fromEvent)
- [fromPromise()](/api/fromPromise)
- [fromObs()](/api/fromObs)
- [of()](/api/of)
- [empty()](/api/empty)
- [never()](/api/never)
- [throwError()](/api/throwError)
- [interval()](/api/interval)
- [fromCron()](/api/fromCron)
- [fromTrigger()](/api/fromTrigger)
- [route()](/api/route)

## Operators

- [pipeRaw()](/api/pipeRaw)
- [map()](/api/map)
- [filter()](/api/filter)
- [scan()](/api/scan)
- [take()](/api/take)
- [skip()](/api/skip)
- [first()](/api/first)
- [last()](/api/last)
- [find()](/api/find)
- [elementAt()](/api/elementAt)
- [distinctUntilChanged()](/api/distinctUntilChanged)
- [startWith()](/api/startWith)
- [pairwise()](/api/pairwise)
- [takeUntil()](/api/takeUntil)
- [takeWhile()](/api/takeWhile)
- [withLatestFrom()](/api/withLatestFrom)
- [partition()](/api/partition)
- [switchMap()](/api/switchMap)
- [concatMap()](/api/concatMap)
- [exhaustMap()](/api/exhaustMap)
- [flat()](/api/flat)
- [share()](/api/share)
- [tap()](/api/tap)
- [remember()](/api/remember)
- [cached()](/api/cached)

## Multi-source

- [merge()](/api/merge)
- [combine()](/api/combine)
- [concat()](/api/concat)
- [race()](/api/race)

## Buffering and Windowing

- [buffer()](/api/buffer)
- [bufferCount()](/api/bufferCount)
- [bufferTime()](/api/bufferTime)
- [window()](/api/window)
- [windowCount()](/api/windowCount)
- [windowTime()](/api/windowTime)
- [sample()](/api/sample)
- [audit()](/api/audit)
- [timeout()](/api/timeout)

## Aggregation

- [reduce()](/api/reduce)
- [toArray()](/api/toArray)
- [groupBy()](/api/groupBy)

## Error and Resubscription

- [rescue()](/api/rescue)
- [repeat()](/api/repeat)

## Sinks and Interop

- [forEach()](/api/forEach)
- [pausable()](/api/pausable)
- [subject()](/api/subject)
- [wrap()](/api/wrap)
