# Send PINs to students from Gmail (mail merge)

The grade site never stores student email addresses. You add them in a Google Sheet that belongs to your
own account, and a small script in that sheet sends each student their own PIN from your Gmail.

You need: the Google account you want to send from, and about 10 minutes.

## 1. Get the file from the app

1. Sign in at `/teacher`, open **Students & PINs**, click **Mail merge file**.
2. It downloads `pin-mail-merge.csv` with every student in every section: student number, name,
   first name, section, PIN and the sign-in link, plus empty **Email** and **Status** columns.

This file contains PINs. Keep it private and delete it when you are done.

## 2. Put it in a Google Sheet

1. Go to https://sheets.google.com and start a blank spreadsheet.
2. **File > Import > Upload**, choose the CSV. Then:
   * Import location: **Replace current sheet**
   * Separator type: **Comma**
   * **Untick** "Convert text to numbers, dates, and formulas" (this keeps student numbers and PINs exactly as they are).
3. Rename the tab at the bottom to **Students** (exactly that name).
4. Fill in the **Email** column for each student.
   * Paste them from your class list, or
   * if student emails follow a pattern, leave the column blank and set the **Email pattern** in step 4 below.

## 3. Add the script

1. In the sheet: **Extensions > Apps Script**.
2. Delete the code that is there, then paste the whole of `mailmerge/Code.gs`. On a Mac you can copy it with
   `pbcopy < mailmerge/Code.gs` in the terminal.
3. Click the save icon, then reload the Google Sheet tab. A new menu **PIN Mail Merge** appears.
   (When a newer `Code.gs` is released, paste it over the old one the same way and save.)

## 4. Write the message

1. **PIN Mail Merge > Create the Template sheet**. A **Template** tab appears.
2. Edit column B:
   * **Subject** and **Message**. Any `{{Column name}}` is replaced for each student, for example
     `{{First name}}`, `{{Student no.}}`, `{{PIN}}`, `{{Section}}`, `{{Link}}`, `{{Name}}`.
   * **Sender name**, and **Reply-to email** if replies should go somewhere else.
   * **Email pattern**: only used when a student's Email cell is blank. `{id}` becomes the student number in
     lowercase, so `{id}@yourschool.edu.ph` turns `2026-00123` into `2026-00123@yourschool.edu.ph`.
   * **Only send to section**: type a section name to send to just that section (blank means everyone).
3. Replace "Your instructor" at the end of the message with your name.

If the message uses a `{{placeholder}}` that is not a column name, the script sends nothing and tells you which one.

## 5. Test, then send

1. **PIN Mail Merge > Send a test email to me**. It sends the first student's email to *you*, labelled
   `[TEST]`, and marks nobody as sent. Check your inbox (and spam).
2. The first time, Google asks you to authorize the script. It will say "Google hasn't verified this app":
   click **Advanced > Go to ... (unsafe)**. That warning appears because you wrote the script yourself;
   it only asks to read and edit this sheet and to send email as you.
3. **PIN Mail Merge > Send PINs to students**. It shows how many emails will go out and your remaining
   daily limit, and asks you to confirm.

## What to know

* **Daily limit.** A free Gmail account can send about 100 emails a day through scripts (a Google Workspace
  account allows more, about 1,500). **PIN Mail Merge > Show today's remaining email limit** shows your exact
  number. With 144 students you will need two days; the script stops at the limit and tells you.
* **It never sends twice.** Each email sent is marked in the **Status** column (`Sent 2026-10-31 10:00`).
  Run it again tomorrow and it continues with the students who are still waiting. Rows with no valid email
  or no PIN are marked `Skipped: ...`; fix them and run it again.
* **Adding students later.** Keep using the same Sheet. Do not re-import over the **Students** tab and do not
  use "Append rows": either one loses your Sent marks or lists everyone twice, and they would be emailed again.
  Instead:
  1. In the app, download a fresh **Mail merge file** (it lists everyone).
  2. In the Sheet, add a new tab named **New** (the **+** at the bottom) and import the file into it.
  3. **PIN Mail Merge > Add new students from the 'New' tab.** It adds only the students who are not in
     **Students** yet, at the bottom, and leaves your existing rows, emails and Sent marks alone. It also tells
     you if any existing student has a different PIN in the new file (it does not change them).
  4. Answer Yes to delete the **New** tab (it holds every PIN), fill in the new students' emails, and run
     **Send PINs to students**. Only the new rows go out.
* **Sending to one student again** (for example after you reset their PIN in the app): update the PIN cell,
  clear that row's Status cell, and run **Send PINs to students**. Everyone else stays marked Sent.
* **Start over:** **Clear all 'Sent' marks** makes the next run email everyone again.
* **Errors** are written in the Status column (for example a rejected address) and the run carries on.

## Privacy

* Each email contains only that student's own PIN. A student number plus a PIN opens that student's grades,
  so ask students to keep the email private and not to forward it.
* The student emails stay in your Google Sheet, not in the grade site.
* When you have finished, delete the Sheet (and the downloaded CSV), because they hold every student's PIN.
* Grades and contact details are personal data under the Data Privacy Act (RA 10173): share the Sheet with
  nobody and use only your school-approved email account if your school requires it.
