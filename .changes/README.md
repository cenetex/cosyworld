# Pending release changes

Each pull request adds one file here instead of editing the version files:

```sh
npm run version:change -- "One-line summary"          # patch
npm run version:change -- minor "One-line summary"
```

The extension is the bump (`.patch`, `.minor` or `.major`) and the file holds a
one-line summary. Files never conflict, because each branch writes its own. After
merge, the Version workflow folds every pending file into one bump commit on
`main`, with the highest level winning, and deploys that commit. A merge commit
that still has pending files does not deploy.
