#include <iostream>
#include <fstream>
#include <cstring>

using namespace std;

struct FECHA_NAC {
    int dia;
    int mes;
    int anio;
};

struct ALUMNO {
    int id;
    char nombre[30];
    float nota;
    FECHA_NAC fechaNac;
};

void GuardarEnBinario(ALUMNO a, int pos) {
    fstream file("alumnos.dat", ios::in | ios::out | ios::binary);
    if (!file.fail()) {
        file.seekp(pos * sizeof(ALUMNO), ios::beg);
        file.write((char*)&a, sizeof(ALUMNO));
        file.close();
    } else {
        ofstream crear("alumnos.dat", ios::binary);
        crear.write((char*)&a, sizeof(ALUMNO));
        crear.close();
    }
}

void MostrarPromedio(int cantidad) {
    ifstream file("alumnos.dat", ios::binary);
    ALUMNO a;
    float suma = 0;

    if (!file.fail()) {
        while (file.read((char*)&a, sizeof(ALUMNO))) {
            suma = suma + a.nota;
        }
        float promedio = suma / cantidad;
        cout << "\nEl promedio general de los alumnos es: " << promedio << endl;
        file.close();
    }
}

bool validarOpcion(string pOpcion) {
    return (pOpcion >= "0" && pOpcion <= "2");
}

int main() {
    ALUMNO a;
    string opcion = "";
    int idActual = 0;

    while (opcion != "0") {
        cout << "\n---Gestion de Alumnos---\n";
        cout << "1-Ingresar alumno" << endl;
        cout << "2-Ver promedio" << endl;
        cout << "0-Salir" << endl;
        cout << "Ingrese una opcion: ";
        cin >> opcion;
        cin.ignore();

        if (validarOpcion(opcion)) {
            if (opcion == "1") {
                a.id = idActual + 1;
                cout << "Ingrese el nombre del alumno: ";
                cin.getline(a.nombre, 30);

                cout << "Ingrese la nota: ";
                cin >> a.nota;

                cout << "Ingrese dia de nacimiento: ";
                cin >> a.fechaNac.dia;

                cout << "Ingrese mes de nacimiento: ";
                cin >> a.fechaNac.mes;

                cout << "Ingrese anio de nacimiento: ";
                cin >> a.fechaNac.anio;

                GuardarEnBinario(a, idActual);
                idActual++;
                cout << "Alumno guardado correctamente.\n";
                cin.ignore();
            }
            else if (opcion == "2") {
                MostrarPromedio(idActual);
            }
        } else {
            cout << "Opcion invalida. Intente nuevamente." << endl;
        }
    }
    return 0;
}