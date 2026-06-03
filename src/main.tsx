import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main className="welcome-page">
      <section className="welcome-shell" aria-labelledby="welcome-title">
        <div className="brand-panel" aria-hidden="true">
          <img
            className="brand-art"
            src="/ProjectFarPoint.png"
            alt=""
          />
        </div>

        <article className="intro">
          <p className="eyebrow">Welcome to Project Far Point</p>
          <h1 id="welcome-title">Project Far Point</h1>
          <div className="welcome-copy">
            <p>
              Project Far Point (PFP) is a geo-blog documenting my attempt to
              travel a cumulative distance equal to the circumference of the
              Earth: 40,076 kilometers. Over the course of a decade or more,
              thousands of walks, backpacking trips, paddling adventures, ski
              tours, and snowshoe excursions will become the real-world
              building blocks of two imagined journeys that together circle the
              globe: <strong className="journey-voyager">Voyager</strong> and
              the <strong className="journey-far-point">Far Point Trail</strong>.
            </p>
            <p>
              Voyager begins high in the remote Southern Alps of New Zealand and
              travels, in imagination, 20,038 kilometers through Australia, Asia,
              and Europe to its destination: the Cathedral of St. James in
              Santiago de Compostela, Spain - the famed terminus of the Camino
              de Santiago and the exact antipode of its starting point.
            </p>
            <p>
              The reality behind Voyager is far less direct, but no less
              meaningful. Every local walk, winter outing, river float, and day
              hike contributes to the journey. With a focus on autumn, winter,
              and spring adventures near my home in Calgary, Alberta, Voyager
              will also chronicle travels to all fifty U.S. states, Canada's
              thirteen provinces and territories, and walking explorations of
              fifty of the world's great cities.
            </p>
            <p>
              The second half of the project, the Far Point Trail, is Voyager's
              wild twin. It imagines an oceanic return voyage from Santiago back
              to the Southern Alps of New Zealand. Supporting that fictional
              route is a very real 20,038-kilometer wilderness journey linking
              some of North America's most iconic long-distance trails,
              including Canada's Great Divide Trail and Trans Canada Trail, the
              Pacific Northwest Trail, the Continental Divide Trail, the Arizona
              Trail, the Pacific Crest Trail, and the Oregon and California
              coastal trails.
            </p>
            <p>
              Together, Voyager and the Far Point Trail will one day complete a
              full circumnavigation of the Earth.
            </p>
            <p>
              The destination may be years away, but the adventure begins with
              the next step. I'm already planning a celebration in the courtyard
              of St. James Cathedral in 2038! Until then, I invite you to follow
              along and share in the journey.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
