# stratus api
api is in /api/

docs and website are in /src/

find game keys in cloud.json

## running the website (with docs)
```sh
bun i # or whatever package manager you use
bun run dev
```

## running the api (from your server)
1. make sure you have a `sites.json` (already provided)
2. set your limits if you want
3. run the following
```sh
cd api
bun i # or whatever pkg manager you use
bun api.js
```
