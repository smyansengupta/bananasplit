import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";

import { SLASH_COMMAND_ITEMS, type SlashCommandItem } from "./slash-command-items";
import { SlashCommandList, type SlashCommandListHandle } from "./slash-command-list";

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        items: ({ query }: { query: string }) => {
          const needle = query.toLowerCase();
          return SLASH_COMMAND_ITEMS.filter(
            (item) =>
              needle.length === 0 ||
              item.title.toLowerCase().includes(needle) ||
              item.keywords.some((keyword) => keyword.includes(needle)),
          ).slice(0, 10);
        },
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: SlashCommandItem;
        }) => {
          props.run(editor, range);
        },
        render: () => {
          let component: ReactRenderer<SlashCommandListHandle> | undefined;
          let unmount: (() => void) | undefined;

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashCommandList, {
                editor: props.editor,
                props,
              });
              unmount = props.mount(component.element);
            },
            onUpdate: (props) => {
              component?.updateProps(props);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                unmount?.();
                component?.destroy();
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              unmount?.();
              component?.destroy();
            },
          };
        },
      } satisfies Partial<SuggestionOptions<SlashCommandItem>>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
