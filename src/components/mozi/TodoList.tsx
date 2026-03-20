'use client';

import { useState } from 'react';
import type { Status } from '@/lib/mozi-engine';

interface TodoListProps {
  status: Status;
  capacityPct: number;
  ratio: number;
  requiredRatio: number;
}

interface TodoItem {
  color: 'red' | 'green' | 'amber';
  tag: string;
  text: string;
  boldText: string;
  worth: string;
}

function generateTodos(status: Status, capacityPct: number): TodoItem[] {
  const todos: TodoItem[] = [];

  if (status === 'stop') {
    todos.push({
      color: 'red',
      tag: 'profit',
      boldText: 'Raise price or restructure payments.',
      text: ' Model needs more profit per client.',
      worth: 'Lever #1',
    });
    todos.push({
      color: 'red',
      tag: 'profit',
      boldText: 'Add fast-cash upsell',
      text: ' in first 30 days.',
      worth: 'Lever #2',
    });
  } else if (status === 'buy') {
    todos.push({
      color: 'green',
      tag: 'ads',
      boldText: "Increase Keith's ad budget 10%.",
      text: ' His clients pay back fastest.',
      worth: '+$2,100/mo',
    });
  }

  todos.push({
    color: 'amber',
    tag: 'sales',
    boldText: '30 min call practice with closers.',
    text: ' Close rate 28% vs 35% goal.',
    worth: '+$8,400/mo',
  });

  if (capacityPct >= 85) {
    todos.push({
      color: 'amber',
      tag: 'delivery',
      boldText: 'Start looking for a new coach.',
      text: ' Kai has 42 clients (max 40).',
      worth: 'Prevents churn',
    });
  }

  return todos;
}

const COLOR_MAP = {
  red: { bg: 'var(--red-bg)', color: 'var(--red)', border: 'var(--red-b)' },
  green: { bg: 'var(--green-bg)', color: 'var(--green)', border: 'var(--green-b)' },
  amber: { bg: 'var(--amber-bg)', color: 'var(--amber)', border: 'var(--amber-b)' },
};

export function TodoList({ status, capacityPct }: TodoListProps) {
  const todos = generateTodos(status, capacityPct);
  const [done, setDone] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div
      className="mb-4"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        padding: '20px 22px',
      }}
    >
      <h3
        className="uppercase font-bold"
        style={{
          fontSize: 11,
          letterSpacing: 1.5,
          color: 'var(--gold)',
          marginBottom: 12,
        }}
      >
        Do This Today
      </h3>

      <div className="flex flex-col gap-1.5">
        {todos.map((todo, i) => {
          const c = COLOR_MAP[todo.color];
          const isDone = done.has(i);

          return (
            <div
              key={i}
              onClick={() => toggle(i)}
              className="relative flex items-start gap-2.5 cursor-pointer transition-all duration-200"
              style={{
                fontSize: 13,
                color: 'var(--text-2)',
                lineHeight: 1.5,
                padding: '10px 14px',
                background: 'rgba(255,255,255,0.015)',
                borderRadius: 'var(--rs)',
                border: '1px solid var(--border)',
                opacity: isDone ? 0.3 : 1,
                textDecoration: isDone ? 'line-through' : 'none',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-hover)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              }}
            >
              {/* Number badge */}
              <div
                className="flex items-center justify-center shrink-0 font-extrabold"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  fontSize: 11,
                  background: c.bg,
                  color: c.color,
                  border: `1px solid ${c.border}`,
                }}
              >
                {i + 1}
              </div>

              <div>
                <span
                  className="uppercase font-extrabold mr-1"
                  style={{
                    fontSize: 9,
                    letterSpacing: 0.7,
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: c.bg,
                    color: c.color,
                  }}
                >
                  {todo.tag}
                </span>
                <b style={{ color: 'var(--text)', fontWeight: 700 }}>{todo.boldText}</b>
                {todo.text}
              </div>

              <div
                className="absolute font-semibold"
                style={{
                  right: 14,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 10,
                  color: 'var(--text-3)',
                }}
              >
                {todo.worth}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
