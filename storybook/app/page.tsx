/* eslint-disable @next/next/no-img-element */
import { journeyStops, storyRules, worldpackRuns } from './story-data';

const Picture = ({ src, alt, caption }: { src: string; alt: string; caption: string }) => (
  <figure className="story-picture">
    <img src={src} alt={alt} />
    <figcaption>{caption}</figcaption>
  </figure>
);

const Word = ({ children }: { children: React.ReactNode }) => (
  <span className="world-word">{children}</span>
);

export default function Home() {
  return (
    <main id="top">
      <a className="skip-link" href="#story">Skip to the story</a>

      <nav className="bookmarks" aria-label="Book sections">
        <a className="brand" href="#top" aria-label="The World That Remembered, cover">
          <span aria-hidden="true">✦</span> CosyWorld Storybook
        </a>
        <div className="bookmark-links">
          <a href="#story">Story</a>
          <a href="#guide">Guide</a>
          <a href="#notebook">Proof</a>
        </div>
      </nav>

      <header className="cover" aria-labelledby="storybook-title">
        <div className="cover-copy">
          <p className="eyebrow">A real journey from the CosyWorld simulation</p>
          <h1 id="storybook-title">The World<br />That Remembered</h1>
          <p className="subtitle">A picture-book guide to avatars, items, and locations</p>
          <a className="begin" href="#story">Open the story <span aria-hidden="true">↓</span></a>
        </div>
        <p className="cover-credit">Told by Rati, Landlady of the Blue Cottage</p>
      </header>

      <section className="foreword" aria-labelledby="true-story-title">
        <p className="eyebrow">Before we begin</p>
        <h2 id="true-story-title">This story really happened.</h2>
        <p>
          We started a fresh CosyWorld, made a new traveller, and let the world offer
          its own next choices. The places, items, gifts, and finished work in this book
          all came from that run. Rati is our picture-book guide, standing in for the
          traveller so one familiar little mouse can lead every page.
        </p>
        <p className="foreword-note">The events are evidence. The telling is a story.</p>
      </section>

      <article id="story" aria-label="The World That Remembered story">
        <section className="spread" id="avatar" aria-labelledby="avatar-title">
          <div className="page words">
            <p className="chapter">First, somebody arrives</p>
            <h2 id="avatar-title">An avatar is a someone.</h2>
            <p className="story-copy">
              “I woke beside the Cosy Cottage hearth,” said Rati. “I could notice,
              choose, travel, help, and remember. That made me more than a marker on a map.”
            </p>
            <aside className="margin-note">
              <strong>Avatar</strong>
              A person in the world. Some are guided by a player. Others keep making
              choices with the world around them.
            </aside>
            <p className="page-number">1</p>
          </div>
          <div className="page mini-scene" aria-label="A small watercolor scene of the Cottage hearth">
            <div className="hearth-mark" aria-hidden="true">♨</div>
            <blockquote>“A world begins when somebody arrives somewhere.”</blockquote>
            <dl className="three-words">
              <div><dt>someone</dt><dd>avatar</dd></div>
              <div><dt>something</dt><dd>item</dd></div>
              <div><dt>somewhere</dt><dd>location</dd></div>
            </dl>
            <p className="page-number">2</p>
          </div>
        </section>

        <section className="spread image-spread" id="location" aria-labelledby="location-title">
          <div className="page art-page">
            <Picture
              src="/rain-soft-garden.webp"
              alt="Rati, a mouse in a green apron and blue scarf, finds a pearly button under a wet leaf while Gust, a tiny cloud gremlin, watches"
              caption="Rain beads on broad leaves. Round marks dot the grass."
            />
            <p className="page-number">3</p>
          </div>
          <div className="page words">
            <p className="chapter">The path appears</p>
            <h2 id="location-title">A location is a place that remembers.</h2>
            <p className="story-copy">
              The Cottage offered a path to the <Word>Rain-Soft Garden</Word>.
              First the path was discovered. Then Rati chose to travel it. The Garden
              kept its wet stones, its residents, and every little change made there.
            </p>
            <aside className="margin-note">
              <strong>Location</strong>
              A shared place with routes, people, items, and work. It is not just a painted backdrop.
            </aside>
            <p className="page-number">4</p>
          </div>
        </section>

        <section className="spread" id="item" aria-labelledby="item-title">
          <div className="page words">
            <p className="chapter">Under one bright leaf</p>
            <h2 id="item-title">An item is one real thing.</h2>
            <p className="story-copy">
              A <Word>Dewbright Button</Word> waited in the grass. At first it was hidden.
              Then it was found. Then it was held. Gust wanted that pearly weather-mark,
              so the button moved into Gust’s care.
            </p>
            <div className="item-path" aria-label="The Dewbright Button moved from the garden to a hand to Gust">
              <span>garden</span><b aria-hidden="true">→</b><span>hand</span><b aria-hidden="true">→</b><span>Gust</span>
            </div>
            <aside className="margin-note">
              <strong>Item</strong>
              It can be found, carried, used, traded, or given—but it has one real home at a time.
            </aside>
            <p className="page-number">5</p>
          </div>
          <div className="page detail-page">
            <div className="button-portrait" aria-hidden="true"><span>✦</span></div>
            <p className="object-name">Dewbright Button</p>
            <p>A pearled mark for dramatic raindrops.</p>
            <div className="ink-rule" aria-hidden="true" />
            <p className="small-copy">
              Because the button moved, Gust’s next choices changed too. That is how
              a small object becomes part of a large story.
            </p>
            <p className="page-number">6</p>
          </div>
        </section>

        <section className="spread image-spread reverse" id="gift" aria-labelledby="gift-title">
          <div className="page art-page">
            <Picture
              src="/watch-bell-home.webp"
              alt="Rati gently gives a small brass bell to Skull, a very large charcoal wolf beside the warm Cottage hearth"
              caption="Skull accepted the bell with almost no movement at all."
            />
            <p className="page-number">7</p>
          </div>
          <div className="page words">
            <p className="chapter">The bell finds its wolf</p>
            <h2 id="gift-title">A gift changes two stories.</h2>
            <p className="story-copy">
              The <Word>Watch Bell</Word> was small, brass, and mute. Skull wanted it
              beside the doorway—a warning he could answer without words. When the bell
              was given, it left one hand and entered Skull’s story. The world wrote down the kindness.
            </p>
            <aside className="margin-note">
              <strong>Remembered change</strong>
              The next visitor can meet the result, even if they never saw the gift happen.
            </aside>
            <p className="page-number">8</p>
          </div>
        </section>

        <section className="spread image-spread" id="emergence" aria-labelledby="emergence-title">
          <div className="page words">
            <p className="chapter">A shared task in moonlight</p>
            <h2 id="emergence-title">No page knew the next page.</h2>
            <p className="story-copy">
              On the <Word>Moonlit Trail</Word>, an echo needed quieting. Rati read the
              silver signs, prepared, rested when tired, and helped again. Coach mirrored
              every try. At last the shared work reached four of four, and the trail remembered quieted moonlight.
            </p>
            <aside className="margin-note">
              <strong>Emergent story</strong>
              The story grew from current world state, a few honest choices, and their results—not from one fixed quest script.
            </aside>
            <p className="page-number">9</p>
          </div>
          <div className="page art-page">
            <Picture
              src="/moonlit-trail.webp"
              alt="Rati steadies rings of pale moonlight while a friendly mouse-shaped reflection called Coach mirrors the pose"
              caption="A place can change because people keep helping it."
            />
            <p className="page-number">10</p>
          </div>
        </section>

        <section className="spread image-spread reverse" id="home" aria-labelledby="home-title">
          <div className="page art-page">
            <Picture
              src="/moonwool-home.webp"
              alt="Rati carries a glowing silver thread along a winding path from the Quiet Abbey, through the Lost Woods, and under a vast Old Oak"
              caption="The road home was longer because the world had grown."
            />
            <p className="page-number">11</p>
          </div>
          <div className="page words">
            <p className="chapter">The long way home</p>
            <h2 id="home-title">The world kept opening.</h2>
            <p className="story-copy">
              The <Word>Old Oak Tree</Word> opened the <Word>Lost Woods</Word>.
              The Woods opened the <Word>Quiet Abbey</Word>. There, Moonwool Thread found
              a hand—or a resident found it first. Either result was allowed. The world continued honestly.
            </p>
            <p className="story-copy final-line">
              Rati returned to the Garden. It was the same place. It was not the same story.
            </p>
            <p className="page-number">12</p>
          </div>
        </section>
      </article>

      <section className="route-ribbon" aria-labelledby="route-title">
        <p className="eyebrow">The core route inside this run</p>
        <h2 id="route-title">A story is a path through remembered places.</h2>
        <ol>
          {journeyStops.map((stop, index) => (
            <li key={`${stop}-${index}`}><span>{index + 1}</span>{stop}</li>
          ))}
        </ol>
      </section>

      <section className="guide" id="guide" aria-labelledby="guide-title">
        <div className="guide-intro">
          <p className="eyebrow">The children’s storybook style guide</p>
          <h2 id="guide-title">How to tell a CosyWorld story</h2>
          <p>
            Write simply enough to read aloud. Keep the impossible matter-of-fact.
            Treat a cup, a button, or a promise with great importance.
          </p>
        </div>
        <div className="rule-grid">
          {storyRules.map((rule, index) => (
            <article key={rule.title}>
              <span aria-hidden="true">0{index + 1}</span>
              <h3>{rule.title}</h3>
              <p>{rule.text}</p>
            </article>
          ))}
        </div>
        <div className="voice-card">
          <div>
            <p className="eyebrow">Voice</p>
            <h3>Warm, exact, and a little strange.</h3>
          </div>
          <div className="voice-examples">
            <p><strong>Say:</strong> “The bell moved to Skull, and the doorway remembered.”</p>
            <p><strong>Avoid:</strong> “The user completed the item-transfer objective.”</p>
          </div>
        </div>
      </section>

      <section className="notebook" id="notebook" aria-labelledby="notebook-title">
        <div className="notebook-heading">
          <p className="eyebrow">From the simulation notebook</p>
          <h2 id="notebook-title">What we proved before writing</h2>
          <p>
            The book is a gentle retelling of actual system checks. These are the plain facts underneath it.
          </p>
        </div>
        <div className="proof-numbers" aria-label="Proof world results">
          <div><strong>8</strong><span>reachable rooms</span></div>
          <div><strong>3</strong><span>repeatable care loops</span></div>
          <div><strong>0</strong><span>dead rooms</span></div>
          <div><strong>6</strong><span>experience packs replayed</span></div>
        </div>
        <div className="proof-columns">
          <div>
            <h3>Living-world evidence</h3>
            <ul className="check-list">
              <li>Dewbright Button reached Gust.</li>
              <li>Watch Bell reached Skull.</li>
              <li>The Moonlit Trail project completed at 4/4.</li>
              <li>Old Oak, Lost Woods, and Quiet Abbey were discovered in play.</li>
              <li>The final world replay caught up to the current state.</li>
            </ul>
          </div>
          <div>
            <h3>Worldpacks opened and replayed</h3>
            <ul className="pack-list">
              {worldpackRuns.map((pack) => (
                <li key={pack.name}>
                  <span>{pack.name}</span>
                  <small>{pack.place}</small>
                  <b aria-label="Replay passed">✓</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="proof-note">
          The longer run also visited the Lantern Keeper inns and Homeroom. A services-only
          composition was checked too: it correctly offered no playable world and created no journal records.
        </p>
      </section>

      <section className="last-page" aria-labelledby="last-page-title">
        <img src="/social-card.jpg" alt="An open storybook, button, bell, moonlit path, glowing thread, and lantern painted in watercolor" />
        <div>
          <p className="eyebrow">The last page is a door</p>
          <h2 id="last-page-title">The next traveller begins in the same world, but not the same story.</h2>
          <a className="begin dark" href="#top">Close the book <span aria-hidden="true">↑</span></a>
        </div>
      </section>

      <footer>
        <p><strong>The World That Remembered</strong> · A CosyWorld picture-book guide</p>
        <p>Story facts from the deterministic proof world and living-world browser simulation.</p>
      </footer>
    </main>
  );
}
