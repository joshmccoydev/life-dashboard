"use client";
import { Component, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

export class PanelBoundary extends Component<
  { children: ReactNode; name: string },
  { failed: boolean }
> {
  state = { failed: false };
  private retryTimer?: ReturnType<typeof setTimeout>;
  componentWillUnmount() {
    clearTimeout(this.retryTimer);
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.setState({ failed: false }), 30000);
    console.error(
      JSON.stringify({
        event: "panel_render_failed",
        panel: this.props.name,
        message: error.message,
      }),
    );
  }
  render() {
    return this.state.failed ? (
      <section className="panel panel-error">
        <TriangleAlert />
        <h2>{this.props.name}</h2>
        <p>
          This panel is temporarily unavailable. Retrying automatically in 30
          seconds.
        </p>
      </section>
    ) : (
      this.props.children
    );
  }
}
