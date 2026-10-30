import { useUiText } from "../i18n/LocaleContext";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { APP_VERSION, PRODUCT_NAME_EN, PRODUCT_NAME_ZH } from "../product-info";

interface AppErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onReload?: () => void;
}

interface AppErrorBoundaryState {
  readonly failed: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Deliberately local: the MVP does not send errors or document content anywhere.
  }

  private reload = () => {
    if (this.props.onReload) this.props.onReload();
    else window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return <CrashScreen reload={this.reload} />;
  }
}

function CrashScreen({ reload }: { reload: () => void }) {
  const t = useUiText();
  return (
      <main className="editor-app-shell project-gate">
        <section className="project-gate__card app-error-boundary" role="alert">
          <span>{PRODUCT_NAME_ZH} · {PRODUCT_NAME_EN}</span>
          <h1>{t("页面出错了")}</h1>
          <p>{t("刷新后会重新读取本机已保存的内容，未保存的修改可能丢失")}</p>
          <small>{t("版本 {0}", APP_VERSION)}</small>
          <div className="project-gate__actions">
            <button type="button" onClick={reload}>{t("刷新页面")}</button>
          </div>
        </section>
      </main>
    );
}
