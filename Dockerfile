FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN ./mvnw package -DskipTests 2>/dev/null || (apt-get install -y maven 2>/dev/null; mvn package -DskipTests)

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
RUN mkdir -p /app/keys
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
