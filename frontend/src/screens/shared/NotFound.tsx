import { Compass } from "lucide-react";
import { useNavigate } from "react-router";
import { Screen } from "../../components/Layout";
import { Button, EmptyState } from "../../components/ui";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <Screen title="Страница не найдена">
      <div className="mt-4">
        <EmptyState icon={<Compass className="size-6" />} title="Такого раздела нет" text="Возможно, ссылка устарела или раздел недоступен для вашей роли"
          action={<Button onClick={() => navigate("/", { replace: true })}>На главную</Button>} />
      </div>
    </Screen>
  );
}
