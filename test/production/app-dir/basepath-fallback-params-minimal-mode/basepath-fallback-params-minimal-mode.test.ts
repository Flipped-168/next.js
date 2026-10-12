import { nextTestSetup } from 'e2e-utils'
import type * as Playwright from 'playwright'

// Reproduces, without a Vercel deployment, the
// `basepath-fallback-params` client-navigation failure on the legacy
// (non-adapter) deploy leg.
//
// Evidence from the failing deployment:
// - A full navigation to `/dashboard/items/expected-id` was served from
//   `x-matched-path: /items/[itemId].rsc`, and its router tree had
//   `k: "%%drp:itemId:<hash>%%"`.
// - The fallback shell has no postponed state. For such a shell, the legacy
//   builder configures the navigation data route with `allowQuery: []`.
//
// The test emulates that routing locally. It renders the param-free
// route-template request in minimal mode and serves the result to a real
// concrete client navigation. The platform-to-function request is an
// inference from the builder configuration, not a captured request.
describe('basepath-fallback-params-minimal-mode', () => {
  const { next } = nextTestSetup({
    files: __dirname,
    // This invokes the renderer the way the platform does, bypassing a
    // deployment's public router. The real-deployment behavior is covered by
    // the deploy suite, not by this local emulation.
    skipDeployment: true,
    env: {
      // Keep `x-matched-path`, which the platform sets, on the request.
      NEXT_PRIVATE_TEST_HEADERS: '1',
      NEXT_PRIVATE_MINIMAL_MODE: '1',
    },
  })

  it('does not generate postponed state for the fallback shell', async () => {
    const metadata = await next.readJSON('.next/server/app/items/[itemId].meta')
    expect(metadata.postponed).toBeUndefined()
  })

  it('renders the concrete param after a navigation served from the shared fallback data route', async () => {
    let servedSharedResponse = false
    const browser = await next.browser('/dashboard', {
      async beforePageLoad(page: Playwright.Page) {
        await page.route('**/dashboard/items/expected-id?**', async (route) => {
          const request = route.request()
          const headers = request.headers()
          if (headers.rsc !== '1' || headers['next-router-prefetch']) {
            await route.continue()
            return
          }

          servedSharedResponse = true
          const response = await next.fetch('/dashboard/items/[itemId]', {
            headers: { 'x-matched-path': '/items/[itemId]', rsc: '1' },
          })
          const responseHeaders = Object.fromEntries(response.headers)
          delete responseHeaders['content-encoding']
          delete responseHeaders['content-length']
          await route.fulfill({
            status: response.status,
            headers: responseHeaders,
            body: Buffer.from(await response.arrayBuffer()),
          })
        })
      },
    })

    await browser.elementByCss('a').click()

    expect(await browser.elementById('item-id').text()).toBe('expected-id')
    expect(servedSharedResponse).toBe(true)
  })
})
