'use client';

import { useEffect, useRef } from 'react';

export function RichTextEditor({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = value;
  }, [value]);

  const format = (command: string) => {
    editorRef.current?.focus();
    document.execCommand(command);
    onChange(editorRef.current?.innerHTML || '');
  };

  return <div className="rich-editor">
    <div className="rich-toolbar" aria-label="富文本格式工具栏">
      <button type="button" title="加粗" aria-label="加粗" onMouseDown={event => event.preventDefault()} onClick={() => format('bold')}><strong>B</strong></button>
      <button type="button" title="斜体" aria-label="斜体" onMouseDown={event => event.preventDefault()} onClick={() => format('italic')}><em>I</em></button>
      <button type="button" title="下划线" aria-label="下划线" onMouseDown={event => event.preventDefault()} onClick={() => format('underline')}><u>U</u></button>
      <button type="button" title="无序列表" onMouseDown={event => event.preventDefault()} onClick={() => format('insertUnorderedList')}>• 列表</button>
      <button type="button" title="有序列表" onMouseDown={event => event.preventDefault()} onClick={() => format('insertOrderedList')}>1. 列表</button>
      <button type="button" title="清除格式" onMouseDown={event => event.preventDefault()} onClick={() => format('removeFormat')}>清除格式</button>
    </div>
    <div ref={editorRef} className="rich-editor-content" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" data-placeholder={placeholder} onInput={event => onChange(event.currentTarget.innerHTML)} />
  </div>;
}
