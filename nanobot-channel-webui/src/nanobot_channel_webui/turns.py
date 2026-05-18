"""Turn lifecycle helpers for the WebUI plugin."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class TurnSnapshot:
    """Immutable view of one turn's completion state."""

    stream_id: str | None
    had_stream_output: bool
    finished: bool
    should_emit_completion: bool


@dataclass(slots=True)
class _TurnState:
    stream_id: str | None = None
    had_stream_output: bool = False
    finished: bool = False


class TurnAccumulator:
    """Track backend turn lifecycle per chat id."""

    def __init__(self) -> None:
        self._turns: dict[str, _TurnState] = {}

    def begin_stream(self, chat_id: str, stream_id: str | None) -> bool:
        state = self._turns.setdefault(chat_id, _TurnState())
        if state.finished:
            return False
        previous = state.stream_id
        state.stream_id = stream_id
        return previous != stream_id

    def note_stream_output(self, chat_id: str) -> None:
        state = self._turns.setdefault(chat_id, _TurnState())
        if state.finished:
            return
        state.had_stream_output = True

    def had_stream_output(self, chat_id: str) -> bool:
        state = self._turns.get(chat_id)
        return bool(state and state.had_stream_output)

    def active_stream_id(self, chat_id: str) -> str | None:
        state = self._turns.get(chat_id)
        return state.stream_id if state is not None else None

    def finish(self, chat_id: str) -> TurnSnapshot:
        state = self._turns.setdefault(chat_id, _TurnState())
        if state.finished:
            return TurnSnapshot(
                stream_id=state.stream_id,
                had_stream_output=state.had_stream_output,
                finished=True,
                should_emit_completion=False,
            )
        state.finished = True
        return TurnSnapshot(
            stream_id=state.stream_id,
            had_stream_output=state.had_stream_output,
            finished=True,
            should_emit_completion=True,
        )

    def clear(self, chat_id: str) -> None:
        self._turns.pop(chat_id, None)

    def snapshot(self) -> dict[str, object]:
        return {
            "active_turn_count": len(self._turns),
            "turns": {
                chat_id: {
                    "stream_id": state.stream_id,
                    "had_stream_output": state.had_stream_output,
                    "finished": state.finished,
                }
                for chat_id, state in self._turns.items()
            },
        }
