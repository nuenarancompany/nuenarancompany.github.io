# Nuenaran Excel updater

This local tool reads the company Excel workbook and updates the `houses` collection in the `nuenaran` Firebase project. The website pages read that same collection. **It does not generate HTML files or publish website code.**

## Download and setup

1. Download the repository, then open this `tools/excel-updater` folder.
2. Install Node.js and run `npm install` in this folder. The required `xlsx` version is pinned in `package.json`.
3. Obtain the private Firebase service-account JSON through an approved secure channel. Store it **outside the website/repository folder** and restrict its permissions to authorized operators. Create a local `private-key-path.txt` in this updater folder containing only the absolute path to that JSON file on one line. This path file is ignored by Git. **Never upload the JSON key to GitHub or put it in the public website folder.**
4. Keep your `backups` folder secure; backups contain company records and are not for GitHub.

## Each Excel update

- Windows: drag the `.xlsx` file onto `Update-Website.cmd`, or run the launcher and enter its path.
- macOS/Linux: run `sh Update-Website.sh "/path/to/new.xlsx"` from a terminal.
- On any system, you can run `node updater.cjs --preview "/path/to/new.xlsx" --key "/private/path/key.json"` and then `node updater.cjs --apply "/path/to/new.xlsx" --key "/private/path/key.json"` from this folder.

The launcher shows a **preview first**. Read the house counts, changes and non-zero cells. Apply only when they match the workbook. Applying asks for the exact word `UPDATE` and saves a timestamped JSON backup before writing. If the preview fails or a sheet layout/identity looks wrong, stop and investigate; do not force an import.

Important interpretation: numeric `0` is paid; blank months before a later paid month are skipped historical months; non-zero text is reported for human review. Yellow Qandil rows are excluded. Existing website-entered payments are preserved. A house missing from a workbook is not automatically deleted.

The tool needs internet access and a credential with permission to read and update the project's Firestore collection. Its source code may be public, but **credentials, workbooks and backups must remain private**.
