# Our Movies

Every movie we have watched together. A plain HTML, CSS and JavaScript site, so it runs on GitHub Pages with no build step.

## Files

- `index.html`, `style.css`, `app.js`: the site
- `movies-data.js`: the movie list (114 movies)
- `movie_poster/`: poster images

## Add a movie

Choose **Add movie** on the site, using Chrome or Edge.

- The first time you save, pick this folder (the one with `index.html`). The browser remembers it.
- After that, every add, edit or delete updates `movies-data.js` and copies the chosen poster into `movie_poster/`.
- To publish the change, push the folder to GitHub.

Other browsers can still add movies, but they are saved in that browser only.

## Publish on GitHub Pages

1. Create a new repository on GitHub, for example `our-movies`.
2. Upload this folder's contents (not the `.xlsx` files).
3. In the repository, open Settings, then Pages, set the source to the `main` branch and the `/ (root)` folder, and save.
4. The site appears at `https://<your-username>.github.io/our-movies/` after a minute or two.
