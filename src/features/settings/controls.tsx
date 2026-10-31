import type { ReactNode } from "react";

export function Row(props: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string; stack?: boolean }) {
  return (
    <div className={`st-row ${props.stack ? "is-stack" : ""}`}>
      <div className="st-row__text">
        {props.htmlFor ? <label htmlFor={props.htmlFor}>{props.label}</label> : <span className="st-row__label">{props.label}</span>}
        {props.hint && <span className="st-row__hint">{props.hint}</span>}
      </div>
      <div className="st-row__control">{props.children}</div>
    </div>
  );
}

export function Group(props: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="st-group">
      <header>
        <h3>{props.title}</h3>
        {props.aside}
      </header>
      <div className="st-group__body">{props.children}</div>
    </section>
  );
}
