# Triodos > YNAB

## Installation

Make sure you have [Node.js](https://nodejs.org/en/download/) installed on your computer.

* Run `npm install` to install all dependencies.
* Run `npm run build` to build the application.

## Configuration

Create file `.env` (don't forget the `.`!) in the root directory, with the following contents:

```
YNAB_ACCESS_TOKEN=your_access_token
IDENTIFIER_ID=your_triodos_identifier_number
```

* Go to your [YNAB developer settings](https://app.youneedabudget.com/settings/developer) and generate a new Personal Access Token. Copy this token and paste it the `.env` file.
* Insert the number in the `.env` file that's on the back your physicial Triodos identifier.
* To link an account in your budget, edit the account and enter the IBAN in the **"Account Notes"** field. For example: for your shared account in YNAB, enter the IBAN of your shared account in Triodos, eg _NL12 TRIO 3456 7890 00_.

## Usage

Run `npm start` to run the program. 
* It will open the Triodos web interface using an invisible browser.
* It will prompt you for an access code. Turn on your identifier and go to `1. Inloggen`. Enter your personal PIN on your identifier. Enter the code that is on your display and press ENTER.
* It will fetch all your accounts across all your budgets and checks if the note has a valid IBAN number. If it has, it will check if this IBAN exists in your Tridos account and fetch the latest 50 transactions of the last month, convert it to a YNAB compatible format and send it to your YNAB account.
* When it is done doing all that, go to your accounts in your YNAB web interface. Now you can edit and approve/reject new transactions. Most transactions probably still need some manual actions, such as adding the correct categories. 
