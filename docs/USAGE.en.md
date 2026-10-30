# ConvoScroll user guide

[Open ConvoScroll](https://convoscroll.lexencole.com) · [Back to overview](../README.en.md) · [简体中文](USAGE.md)

## Edit a conversation

Click **ConvoScroll** at the top left to open the Document menu. Create a conversation, load a sample, import a file, or adjust settings.

- Click text, a title, or a table to edit it. Click a speaker's avatar to change their name, model, or other details.
- Use **User message** or **AI reply** to add a message. The **…** menus beside messages and content provide copy, move, and delete actions.
- Type `/` in an empty paragraph to add code, equations, tables, images, or files. Markdown shortcuts work while typing.
- Use the toolbar to undo or redo. Reasoning and tool records can be collapsed, with their appearance controlled in export settings.

Change the interface language in **Document → Language**. Set the language for role and status labels in the image under **Title and description → Image language**.

## Import content

Open Markdown files or ConvoScroll projects through **Document → Import project or Markdown**.

## Export and back up

Check the result with **Preview**, then choose **Export PNG**. **Document → Export settings** controls canvas width, resolution, collapsed content, and splitting. Long conversations can be exported as multiple PNGs in one download.

Choose **Document → Export project** to save a `.convcanvas` backup with your editable conversation and attachments. Import it later to continue editing.

## Use the Agent Skill

Add the complete [convoscroll Skill directory](../skills/convoscroll/) to a client that supports Agent Skills. Provide chat content or screenshots, describe what to keep, and ask for a summary, translation, or redaction if needed. The agent will prepare the content and export an image.

Use an agent with browser and file capabilities. See the [Skill instructions](../skills/convoscroll/SKILL.md) for requirements.

## Storage and privacy

ConvoScroll processes conversations and attachments in the browser without uploading them to its servers. When you use an agent, your chosen AI service handles the content.

The current project saves automatically in your browser. Clearing site data deletes the draft. Export `.convcanvas` to back up your work or move between devices.

Project files include the original attachments. Review their contents before sharing.
